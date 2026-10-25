import { and, asc, eq, inArray, lte, sql } from '@payloadcms/db-postgres/drizzle'
import type { NodePgDatabase } from '@payloadcms/db-postgres/drizzle/node-postgres'

import {
  commerceAuditLog,
  commerceHolds,
  commerceInventory,
  commerceOrderItems,
  commerceOrders,
  commerceOutbox,
  commercePaymentEvents,
  commerceSeats,
  commerceTickets,
} from '@/db/schema/commerce'

import { isPgRetryable } from './retry'
import type {
  CommerceStore,
  CommerceTx,
  HoldRow,
  InventoryKey,
  InventoryRow,
  OrderItemRow,
  OrderRow,
  SeatRow,
  TicketRow,
} from './store'

type Db = NodePgDatabase<Record<string, never>>

const invKey = (k: InventoryKey) =>
  and(
    eq(commerceInventory.performanceId, k.performanceId),
    eq(commerceInventory.ticketTypeId, k.ticketTypeId),
  )

/** Операции одной транзакции (READ COMMITTED + явные блокировки строк). */
function pgTx(db: Db): CommerceTx {
  return {
    async lockInventory(keys) {
      if (!keys.length) return []
      // ORDER BY + FOR NO KEY UPDATE: строки блокируются в порядке сортировки — одинаково для всех.
      // NO KEY: не конфликтует с KEY SHARE, который берут вставки строк со ссылкой (FK) на эту.
      const rows = await db
        .select()
        .from(commerceInventory)
        .where(
          sql`(${commerceInventory.performanceId}, ${commerceInventory.ticketTypeId}) IN (${sql.join(
            keys.map((k) => sql`(${k.performanceId}, ${k.ticketTypeId})`),
            sql`, `,
          )})`,
        )
        .orderBy(asc(commerceInventory.performanceId), asc(commerceInventory.ticketTypeId))
        .for('no key update')
      return rows as InventoryRow[]
    },
    async insertInventory(row) {
      const rows = await db
        .insert(commerceInventory)
        .values(row)
        .onConflictDoNothing()
        .returning({ id: commerceInventory.ticketTypeId })
      return rows.length === 1
    },
    async adjustInventory(key, delta, at) {
      // Один условный UPDATE: при нехватке ничего не меняется (0 строк), CHECK — страховка.
      const rows = await db
        .update(commerceInventory)
        .set({
          held: sql`${commerceInventory.held} + ${delta.held}`,
          sold: sql`${commerceInventory.sold} + ${delta.sold}`,
          updatedAt: at,
        })
        .where(
          and(
            invKey(key),
            sql`${commerceInventory.held} + ${delta.held} >= 0`,
            sql`${commerceInventory.sold} + ${delta.sold} >= 0`,
            sql`${commerceInventory.sold} + ${commerceInventory.held} + ${delta.held + delta.sold} <= ${commerceInventory.capacity}`,
          ),
        )
        .returning({ id: commerceInventory.ticketTypeId })
      return rows.length === 1
    },
    async setCapacity(key, capacity, at) {
      const rows = await db
        .update(commerceInventory)
        .set({ capacity, updatedAt: at })
        .where(
          and(
            invKey(key),
            sql`${commerceInventory.sold} + ${commerceInventory.held} <= ${capacity}`,
          ),
        )
        .returning({ id: commerceInventory.ticketTypeId })
      return rows.length === 1
    },
    async lockSeats(performanceId, seatIds) {
      if (seatIds && !seatIds.length) return []
      const rows = await db
        .select()
        .from(commerceSeats)
        .where(
          seatIds
            ? and(
                eq(commerceSeats.performanceId, performanceId),
                inArray(commerceSeats.seatId, seatIds),
              )
            : eq(commerceSeats.performanceId, performanceId),
        )
        .orderBy(asc(commerceSeats.seatId))
        .for('no key update')
      return rows as SeatRow[]
    },
    async insertSeats(rows) {
      if (rows.length) await db.insert(commerceSeats).values(rows).onConflictDoNothing()
    },
    async updateSeats(performanceId, seatIds, where, set, at) {
      if (!seatIds.length) return 0
      const rows = await db
        .update(commerceSeats)
        .set({ ...set, updatedAt: at })
        .where(
          and(
            eq(commerceSeats.performanceId, performanceId),
            inArray(commerceSeats.seatId, seatIds),
            eq(commerceSeats.status, where.status),
            where.holdId !== undefined ? eq(commerceSeats.holdId, where.holdId) : undefined,
            where.orderId !== undefined ? eq(commerceSeats.orderId, where.orderId) : undefined,
          ),
        )
        .returning({ id: commerceSeats.seatId })
      return rows.length
    },
    async retagSeat(performanceId, seatId, set, at) {
      const rows = await db
        .update(commerceSeats)
        .set({ ...set, updatedAt: at })
        .where(
          and(
            eq(commerceSeats.performanceId, performanceId),
            eq(commerceSeats.seatId, seatId),
            inArray(commerceSeats.status, ['free', 'blocked']),
          ),
        )
        .returning({ id: commerceSeats.seatId })
      return rows.length === 1
    },
    async insertHold(row) {
      await db.insert(commerceHolds).values(row)
    },
    async lockHold(orderId) {
      const [row] = await db
        .select()
        .from(commerceHolds)
        .where(eq(commerceHolds.orderId, orderId))
        .for('no key update')
      return (row as HoldRow | undefined) ?? null
    },
    async closeHold(id, to, at) {
      const rows = await db
        .update(commerceHolds)
        .set({ status: to, closedAt: at })
        .where(and(eq(commerceHolds.id, id), eq(commerceHolds.status, 'ACTIVE')))
        .returning({ id: commerceHolds.id })
      return rows.length === 1
    },
    async insertOrder(row) {
      // Конфликт по ключу идемпотентности (повтор) или номеру (совпадение) — без ошибки;
      // параллельная вставка того же ключа ждёт завершения чужой транзакции.
      const rows = await db
        .insert(commerceOrders)
        .values(row)
        .onConflictDoNothing()
        .returning({ id: commerceOrders.id })
      return rows.length === 1
    },
    async findOrderByKey(key) {
      const [row] = await db
        .select()
        .from(commerceOrders)
        .where(eq(commerceOrders.idempotencyKey, key))
      return (row as OrderRow | undefined) ?? null
    },
    async lockOrder(id) {
      const [row] = await db
        .select()
        .from(commerceOrders)
        .where(eq(commerceOrders.id, id))
        .for('no key update')
      return (row as OrderRow | undefined) ?? null
    },
    async claimExpired(now, limit) {
      const rows = await db
        .select()
        .from(commerceOrders)
        .where(
          and(eq(commerceOrders.status, 'PENDING_PAYMENT'), lte(commerceOrders.holdUntil, now)),
        )
        .orderBy(asc(commerceOrders.holdUntil), asc(commerceOrders.id))
        .limit(limit)
        .for('no key update', { skipLocked: true })
      return rows as OrderRow[]
    },
    async updateOrder(id, from, set, at) {
      const rows = await db
        .update(commerceOrders)
        .set({ ...set, updatedAt: at })
        .where(and(eq(commerceOrders.id, id), eq(commerceOrders.status, from)))
        .returning({ id: commerceOrders.id })
      return rows.length === 1
    },
    async insertItems(rows) {
      if (rows.length) await db.insert(commerceOrderItems).values(rows)
    },
    async listItems(orderId) {
      const rows = await db
        .select()
        .from(commerceOrderItems)
        .where(eq(commerceOrderItems.orderId, orderId))
        .orderBy(asc(commerceOrderItems.id))
      return rows as OrderItemRow[]
    },
    async listTickets(orderId) {
      const rows = await db
        .select()
        .from(commerceTickets)
        .where(eq(commerceTickets.orderId, orderId))
        .orderBy(asc(commerceTickets.number))
      return rows as TicketRow[]
    },
    async insertTickets(rows) {
      if (rows.length) await db.insert(commerceTickets).values(rows)
    },
    async insertOutbox(row) {
      const rows = await db
        .insert(commerceOutbox)
        .values(row)
        .onConflictDoNothing({ target: commerceOutbox.dedupeKey })
        .returning({ id: commerceOutbox.id })
      return rows.length === 1
    },
    async insertAudit(row) {
      await db.insert(commerceAuditLog).values(row)
    },
    async insertPaymentEvent(row) {
      const rows = await db
        .insert(commercePaymentEvents)
        .values(row)
        .onConflictDoNothing({
          target: [commercePaymentEvents.provider, commercePaymentEvents.eventId],
        })
        .returning({ id: commercePaymentEvents.id })
      return rows.length === 1
    },
  }
}

/** Хранилище ядра продаж в PostgreSQL (таблицы src/db/schema/commerce.ts). */
export function pgCommerceStore(db: Db): CommerceStore {
  return {
    async transaction(fn) {
      // Ошибка внутри — ROLLBACK: ни брони, ни заказа, ни билетов.
      return db.transaction((trx) => fn(pgTx(trx as unknown as Db)))
    },
    isRetryable: isPgRetryable,
    async inventory(performanceId) {
      const rows = await db
        .select()
        .from(commerceInventory)
        .where(eq(commerceInventory.performanceId, performanceId))
      return rows as InventoryRow[]
    },
    async seats(performanceId) {
      const rows = await db
        .select()
        .from(commerceSeats)
        .where(eq(commerceSeats.performanceId, performanceId))
      return rows as SeatRow[]
    },
    async order(id) {
      const [row] = await db.select().from(commerceOrders).where(eq(commerceOrders.id, id))
      return (row as OrderRow | undefined) ?? null
    },
    async overdueOrders(now, limit) {
      const rows = await db
        .select()
        .from(commerceOrders)
        .where(
          and(eq(commerceOrders.status, 'PENDING_PAYMENT'), lte(commerceOrders.holdUntil, now)),
        )
        .orderBy(asc(commerceOrders.holdUntil), asc(commerceOrders.id))
        .limit(limit)
      return rows as OrderRow[]
    },
    async items(orderId) {
      const rows = await db
        .select()
        .from(commerceOrderItems)
        .where(eq(commerceOrderItems.orderId, orderId))
        .orderBy(asc(commerceOrderItems.id))
      return rows as OrderItemRow[]
    },
    async tickets(orderId) {
      const rows = await db
        .select()
        .from(commerceTickets)
        .where(eq(commerceTickets.orderId, orderId))
        .orderBy(asc(commerceTickets.number))
      return rows as TicketRow[]
    },
  }
}
