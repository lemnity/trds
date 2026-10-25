import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from '@payloadcms/db-postgres/drizzle'
import type { NodePgDatabase } from '@payloadcms/db-postgres/drizzle/node-postgres'

import {
  commerceAuditLog,
  commerceHolds,
  commerceInventory,
  commerceOrderItems,
  commerceOrders,
  commerceOutbox,
  commercePaymentEvents,
  commerceRefunds,
  commerceRefundTickets,
  commerceSeats,
  commerceSettings,
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
  RefundRow,
  RefundTicketRow,
  SeatRow,
  SettingRow,
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
    async lockTickets(orderId) {
      const rows = await db
        .select()
        .from(commerceTickets)
        .where(eq(commerceTickets.orderId, orderId))
        .orderBy(asc(commerceTickets.id))
        .for('no key update')
      return rows as TicketRow[]
    },
    async updateTickets(ids, from, set) {
      if (!ids.length) return 0
      const rows = await db
        .update(commerceTickets)
        .set(set)
        .where(and(inArray(commerceTickets.id, ids), eq(commerceTickets.status, from)))
        .returning({ id: commerceTickets.id })
      return rows.length
    },
    async insertRefund(row) {
      const rows = await db
        .insert(commerceRefunds)
        .values(row)
        .onConflictDoNothing({ target: commerceRefunds.idempotencyKey })
        .returning({ id: commerceRefunds.id })
      return rows.length === 1
    },
    async findRefundByKey(key) {
      const [row] = await db
        .select()
        .from(commerceRefunds)
        .where(eq(commerceRefunds.idempotencyKey, key))
      return (row as RefundRow | undefined) ?? null
    },
    async lockRefund(id) {
      const [row] = await db
        .select()
        .from(commerceRefunds)
        .where(eq(commerceRefunds.id, id))
        .for('no key update')
      return (row as RefundRow | undefined) ?? null
    },
    async updateRefund(id, from, set, at) {
      const rows = await db
        .update(commerceRefunds)
        .set({ ...set, updatedAt: at })
        .where(and(eq(commerceRefunds.id, id), eq(commerceRefunds.status, from)))
        .returning({ id: commerceRefunds.id })
      return rows.length === 1
    },
    async insertRefundTickets(rows) {
      if (!rows.length) return true
      // Живой возврат билета уже есть — конфликт частичного уникального индекса, без ошибки.
      const inserted = await db
        .insert(commerceRefundTickets)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: commerceRefundTickets.ticketId })
      return inserted.length === rows.length
    },
    async listRefundTickets(refundId) {
      const rows = await db
        .select()
        .from(commerceRefundTickets)
        .where(eq(commerceRefundTickets.refundId, refundId))
        .orderBy(asc(commerceRefundTickets.ticketId))
      return rows as RefundTicketRow[]
    },
    async voidRefundTickets(refundId, at) {
      await db
        .update(commerceRefundTickets)
        .set({ voidedAt: at })
        .where(
          and(eq(commerceRefundTickets.refundId, refundId), isNull(commerceRefundTickets.voidedAt)),
        )
    },
    async liveRefundOfTicket(ticketId) {
      const [row] = await db
        .select({ refund: commerceRefunds })
        .from(commerceRefundTickets)
        .innerJoin(commerceRefunds, eq(commerceRefunds.id, commerceRefundTickets.refundId))
        .where(
          and(eq(commerceRefundTickets.ticketId, ticketId), isNull(commerceRefundTickets.voidedAt)),
        )
      return (row?.refund as RefundRow | undefined) ?? null
    },
    async upsertSetting(row) {
      await db
        .insert(commerceSettings)
        .values(row)
        .onConflictDoUpdate({
          target: commerceSettings.key,
          set: { value: row.value, updatedBy: row.updatedBy, updatedAt: row.updatedAt },
        })
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
    async inventoryOf(performanceIds) {
      if (!performanceIds.length) return []
      const rows = await db
        .select()
        .from(commerceInventory)
        .where(inArray(commerceInventory.performanceId, performanceIds))
      return rows as InventoryRow[]
    },
    async takenSeatsOf(performanceIds) {
      if (!performanceIds.length) return []
      // Только занятые: свободных мест на схеме большинство, их витрине знать не нужно.
      return db
        .select({ performanceId: commerceSeats.performanceId, seatId: commerceSeats.seatId })
        .from(commerceSeats)
        .where(
          and(
            inArray(commerceSeats.performanceId, performanceIds),
            sql`${commerceSeats.status} <> 'free'`,
          ),
        )
    },
    async order(id) {
      const [row] = await db.select().from(commerceOrders).where(eq(commerceOrders.id, id))
      return (row as OrderRow | undefined) ?? null
    },
    async hasLiveOrder(customerId, exceptOrderId) {
      // Индекс commerce_orders_customer_idx (customer_id, created_at).
      const rows = await db
        .select({ id: commerceOrders.id })
        .from(commerceOrders)
        .where(
          and(
            eq(commerceOrders.customerId, customerId),
            inArray(commerceOrders.status, ['PAID', 'PARTIALLY_REFUNDED']),
            exceptOrderId ? sql`${commerceOrders.id} <> ${exceptOrderId}` : undefined,
          ),
        )
        .limit(1)
      return rows.length > 0
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
    async ordersInStatus(statuses, updatedSince, limit) {
      if (!statuses.length) return []
      const rows = await db
        .select()
        .from(commerceOrders)
        .where(
          and(
            inArray(commerceOrders.status, statuses),
            gte(commerceOrders.updatedAt, updatedSince),
          ),
        )
        .orderBy(asc(commerceOrders.updatedAt), asc(commerceOrders.id))
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
    async orderByNumber(number) {
      const [row] = await db.select().from(commerceOrders).where(eq(commerceOrders.number, number))
      return (row as OrderRow | undefined) ?? null
    },
    async ticketByNumber(number) {
      const [row] = await db
        .select()
        .from(commerceTickets)
        .where(eq(commerceTickets.number, number))
      return (row as TicketRow | undefined) ?? null
    },
    async refund(id) {
      const [row] = await db.select().from(commerceRefunds).where(eq(commerceRefunds.id, id))
      return (row as RefundRow | undefined) ?? null
    },
    async refundsOfOrder(orderId) {
      const rows = await db
        .select()
        .from(commerceRefunds)
        .where(eq(commerceRefunds.orderId, orderId))
        .orderBy(asc(commerceRefunds.createdAt), asc(commerceRefunds.id))
      return rows as RefundRow[]
    },
    async refundTickets(refundId) {
      const rows = await db
        .select()
        .from(commerceRefundTickets)
        .where(eq(commerceRefundTickets.refundId, refundId))
        .orderBy(asc(commerceRefundTickets.ticketId))
      return rows as RefundTicketRow[]
    },
    async refundsDue(statuses, now, limit) {
      if (!statuses.length) return []
      const rows = await db
        .select()
        .from(commerceRefunds)
        .where(
          and(
            inArray(commerceRefunds.status, statuses),
            isNotNull(commerceRefunds.nextAttemptAt),
            lte(commerceRefunds.nextAttemptAt, now),
          ),
        )
        .orderBy(asc(commerceRefunds.nextAttemptAt), asc(commerceRefunds.id))
        .limit(limit)
      return rows as RefundRow[]
    },
    async refundsUnsettled(limit) {
      const rows = await db
        .select()
        .from(commerceRefunds)
        .where(and(eq(commerceRefunds.status, 'SUCCEEDED'), isNull(commerceRefunds.bonusSettledAt)))
        .orderBy(asc(commerceRefunds.updatedAt), asc(commerceRefunds.id))
        .limit(limit)
      return rows as RefundRow[]
    },
    async recentRefunds(limit) {
      const rows = await db
        .select()
        .from(commerceRefunds)
        .orderBy(desc(commerceRefunds.createdAt), desc(commerceRefunds.id))
        .limit(limit)
      return rows as RefundRow[]
    },
    async setting(key) {
      const [row] = await db.select().from(commerceSettings).where(eq(commerceSettings.key, key))
      return (row as SettingRow | undefined) ?? null
    },
  }
}
