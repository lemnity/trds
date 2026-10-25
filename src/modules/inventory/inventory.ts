import { getSeatingPlan, seatsOf } from '@/modules/seating'
import type { Performance } from '@/modules/shows'

import { withRetry } from './retry'
import type { CommerceStore, CommerceTx, InventoryKey, OrderItemRow, SeatRow } from './store'

/**
 * Остатки и места (T-042, T-049). Только сервер. Инвариант `sold + held <= capacity` держат
 * сразу три уровня: блокировка строк в одном порядке, условный UPDATE и CHECK в БД. Место
 * переходит free → held → sold условным UPDATE под блокировкой; «продано дважды» невозможно
 * ещё и из-за уникального индекса живых билетов на место.
 *
 * Функции `acquire`/`release`/`commit` работают внутри транзакции вызывающего (заказ и бронь
 * создаются атомарно — `@/modules/orders`); `createInventoryService` — самостоятельные операции
 * (синхронизация вместимости с CMS, остатки для витрины).
 */

/** Позиция брони — как позиция заказа: категория × количество или одно место. */
export type InventoryLine = Pick<
  OrderItemRow,
  'performanceId' | 'ticketTypeId' | 'seatId' | 'quantity'
>

export type UnavailableReason = 'NOT_ON_SALE' | 'SOLD_OUT' | 'SEAT_TAKEN' | 'CATEGORY_MISMATCH'

export type Unavailable = {
  performanceId: string
  ticketTypeId: string
  seatId: string | null
  reason: UnavailableReason
  /** Сколько ещё можно взять в категории (для SOLD_OUT). */
  remaining?: number
}

/** Нарушение инварианта (условное изменение не прошло под блокировкой) — откат и ошибка. */
export class InventoryInvariantError extends Error {}

/** Порядок по кодовым точкам, как `COLLATE "C"`: одинаков в коде и в памяти. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

type Plan = {
  categories: { key: InventoryKey; quantity: number }[]
  seats: { performanceId: string; seats: { seatId: string; ticketTypeId: string }[] }[]
}

/** Сгруппировать позиции и упорядочить детерминированно — от этого зависит порядок блокировок. */
const planLines = (lines: readonly InventoryLine[]): Plan => {
  const categories = new Map<string, { key: InventoryKey; quantity: number }>()
  const seats = new Map<string, Map<string, string>>()
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0)
      throw new RangeError('quantity must be a positive integer')
    if (line.seatId !== null) {
      if (line.quantity !== 1) throw new RangeError('seat line must have quantity 1')
      const bySeat = seats.get(line.performanceId) ?? new Map<string, string>()
      if (bySeat.has(line.seatId)) throw new RangeError('duplicate seat in order')
      bySeat.set(line.seatId, line.ticketTypeId)
      seats.set(line.performanceId, bySeat)
      continue
    }
    const id = JSON.stringify([line.performanceId, line.ticketTypeId])
    const current = categories.get(id)
    if (current) current.quantity += line.quantity
    else
      categories.set(id, {
        key: { performanceId: line.performanceId, ticketTypeId: line.ticketTypeId },
        quantity: line.quantity,
      })
  }
  return {
    categories: [...categories.values()].sort(
      (a, b) =>
        cmp(a.key.performanceId, b.key.performanceId) ||
        cmp(a.key.ticketTypeId, b.key.ticketTypeId),
    ),
    seats: [...seats.entries()]
      .sort(([a], [b]) => cmp(a, b))
      .map(([performanceId, bySeat]) => ({
        performanceId,
        seats: [...bySeat.entries()]
          .sort(([a], [b]) => cmp(a, b))
          .map(([seatId, ticketTypeId]) => ({ seatId, ticketTypeId })),
      })),
  }
}

const sameKey = (a: InventoryKey, b: InventoryKey) =>
  a.performanceId === b.performanceId && a.ticketTypeId === b.ticketTypeId

export type AcquireMode =
  | { kind: 'hold'; holdId: string; orderId: string }
  /** Сразу в продажу, минуя бронь, — поздняя оплата после освобождения брони. */
  | { kind: 'sell'; orderId: string }

/**
 * Взять остаток и места под бронь или сразу в продажу. Сначала блокируются все нужные строки
 * (остатки, затем места — в одном порядке для всех транзакций) и проверяется доступность;
 * если чего-то не хватает — ничего не меняется, возвращается список. Иначе — условные UPDATE.
 */
export async function acquire(
  tx: CommerceTx,
  lines: readonly InventoryLine[],
  mode: AcquireMode,
  at: Date,
): Promise<{ ok: true } | { ok: false; unavailable: Unavailable[] }> {
  const plan = planLines(lines)
  const unavailable: Unavailable[] = []

  const rows = plan.categories.length
    ? await tx.lockInventory(plan.categories.map((c) => c.key))
    : []
  for (const { key, quantity } of plan.categories) {
    const row = rows.find((r) => sameKey(r, key))
    if (!row) unavailable.push({ ...key, seatId: null, reason: 'NOT_ON_SALE' })
    else if (row.sold + row.held + quantity > row.capacity)
      unavailable.push({
        ...key,
        seatId: null,
        reason: 'SOLD_OUT',
        remaining: Math.max(0, row.capacity - row.sold - row.held),
      })
  }

  for (const group of plan.seats) {
    const locked = await tx.lockSeats(
      group.performanceId,
      group.seats.map((s) => s.seatId),
    )
    for (const { seatId, ticketTypeId } of group.seats) {
      const seat = locked.find((s) => s.seatId === seatId)
      const base = { performanceId: group.performanceId, ticketTypeId, seatId }
      if (!seat) unavailable.push({ ...base, reason: 'NOT_ON_SALE' })
      else if (seat.categoryId !== ticketTypeId)
        unavailable.push({ ...base, reason: 'CATEGORY_MISMATCH' })
      else if (seat.status !== 'free') unavailable.push({ ...base, reason: 'SEAT_TAKEN' })
    }
  }
  if (unavailable.length) return { ok: false, unavailable }

  for (const { key, quantity } of plan.categories) {
    const delta = mode.kind === 'hold' ? { held: quantity, sold: 0 } : { held: 0, sold: quantity }
    if (!(await tx.adjustInventory(key, delta, at)))
      throw new InventoryInvariantError('inventory changed under lock')
  }
  for (const group of plan.seats) {
    const ids = group.seats.map((s) => s.seatId)
    const changed = await tx.updateSeats(
      group.performanceId,
      ids,
      { status: 'free' },
      mode.kind === 'hold'
        ? { status: 'held', holdId: mode.holdId, orderId: mode.orderId }
        : { status: 'sold', holdId: null, orderId: mode.orderId },
      at,
    )
    if (changed !== ids.length) throw new InventoryInvariantError('seat changed under lock')
  }
  return { ok: true }
}

/** Освободить бронь: held −q, места held(этой брони) → free. Бронь должна быть активной. */
export async function release(
  tx: CommerceTx,
  lines: readonly InventoryLine[],
  holdId: string,
  at: Date,
) {
  await settle(tx, lines, holdId, 'release', at)
}

/** Превратить бронь в продажу: held −q, sold +q; места held(этой брони) → sold. */
export async function commit(
  tx: CommerceTx,
  lines: readonly InventoryLine[],
  holdId: string,
  orderId: string,
  at: Date,
) {
  await settle(tx, lines, holdId, 'commit', at, orderId)
}

async function settle(
  tx: CommerceTx,
  lines: readonly InventoryLine[],
  holdId: string,
  action: 'release' | 'commit',
  at: Date,
  orderId?: string,
) {
  const plan = planLines(lines)
  if (plan.categories.length) await tx.lockInventory(plan.categories.map((c) => c.key))
  for (const { key, quantity } of plan.categories) {
    const delta =
      action === 'commit' ? { held: -quantity, sold: quantity } : { held: -quantity, sold: 0 }
    if (!(await tx.adjustInventory(key, delta, at)))
      throw new InventoryInvariantError(`cannot ${action} held quantity`)
  }
  for (const group of plan.seats) {
    const ids = group.seats.map((s) => s.seatId)
    await tx.lockSeats(group.performanceId, ids)
    const changed = await tx.updateSeats(
      group.performanceId,
      ids,
      { status: 'held', holdId },
      action === 'commit'
        ? { status: 'sold', holdId: null, orderId: orderId! }
        : { status: 'free', holdId: null, orderId: null },
      at,
    )
    if (changed !== ids.length) throw new InventoryInvariantError(`cannot ${action} held seats`)
  }
}

/**
 * Вернуть проданное в продажу после подтверждённого возврата (T-052/T-053): sold −q, места
 * sold(этого заказа) → free. Блокировки — в том же порядке, что у брони и оплаты. Вызывать ли —
 * решает политика возвратов (`returnToSale`, решение театра); без неё остаток остаётся проданным.
 */
export async function returnSold(
  tx: CommerceTx,
  lines: readonly InventoryLine[],
  orderId: string,
  at: Date,
) {
  const plan = planLines(lines)
  if (plan.categories.length) await tx.lockInventory(plan.categories.map((c) => c.key))
  for (const { key, quantity } of plan.categories)
    if (!(await tx.adjustInventory(key, { held: 0, sold: -quantity }, at)))
      throw new InventoryInvariantError('cannot return sold quantity')
  for (const group of plan.seats) {
    const ids = group.seats.map((s) => s.seatId)
    await tx.lockSeats(group.performanceId, ids)
    const changed = await tx.updateSeats(
      group.performanceId,
      ids,
      { status: 'sold', orderId },
      { status: 'free', holdId: null, orderId: null },
      at,
    )
    if (changed !== ids.length) throw new InventoryInvariantError('cannot return sold seats')
  }
}

/** Что продаётся на показе — источник: CMS (пока демо-данные `@/modules/shows`). */
export type CapacitySpec = {
  performanceId: string
  ticketTypes: { id: string; capacity: number }[]
  seating?: {
    planId: string
    planVersion: number
    seats: { id: string; categoryId: string }[]
    /** Места, закрытые для продажи (технические, снятые театром). */
    blockedSeatIds: string[]
  }
}

export type SyncResult =
  | {
      ok: true
      categoriesCreated: number
      categoriesUpdated: number
      seatsAdded: number
      /** Места заняты бронью/продажей — их категория и закрытие не менялись. */
      seatsInUse: string[]
    }
  | {
      ok: false
      error: 'BELOW_COMMITTED'
      conflicts: { ticketTypeId: string; capacity: number; committed: number }[]
    }

/** Показ из данных CMS → что синхронизировать. Схема зала — по `seating.planId`. */
export const capacityFromPerformance = (performance: Performance): CapacitySpec => {
  const spec: CapacitySpec = {
    performanceId: performance.id,
    ticketTypes: performance.ticketTypes.map((t) => ({ id: t.id, capacity: t.capacity })),
  }
  const plan = performance.seating ? getSeatingPlan(performance.seating.planId) : null
  if (performance.seating && plan)
    spec.seating = {
      planId: plan.id,
      planVersion: plan.version,
      seats: seatsOf(plan).map((s) => ({ id: s.id, categoryId: s.categoryId })),
      blockedSeatIds: performance.seating.unavailableSeatIds,
    }
  return spec
}

class BelowCommitted extends Error {
  constructor(readonly conflicts: { ticketTypeId: string; capacity: number; committed: number }[]) {
    super('capacity below sold + held')
  }
}

const isCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0

export function createInventoryService({ store }: { store: CommerceStore }) {
  /**
   * Синхронизация CMS → inventory (идемпотентна). Вместимость категории нельзя опустить ниже
   * `sold + held`: такая правка отклоняется целиком, ничего не меняется. Места: недостающие
   * добавляются; у свободных/закрытых обновляются категория и закрытие; занятые не трогаются;
   * исчезнувшие из схемы свободные — закрываются (строки не удаляются: на них ссылаются билеты).
   */
  async function syncCapacity(spec: CapacitySpec, now = new Date()): Promise<SyncResult> {
    const ids = new Set<string>()
    for (const t of spec.ticketTypes) {
      if (!isCount(t.capacity)) throw new RangeError('capacity must be a non-negative integer')
      if (ids.has(t.id)) throw new RangeError('duplicate ticket type')
      ids.add(t.id)
    }
    try {
      return await withRetry(store, async (tx) => {
        let categoriesCreated = 0
        let categoriesUpdated = 0
        const keys = [...spec.ticketTypes]
          .sort((a, b) => cmp(a.id, b.id))
          .map((t) => ({
            performanceId: spec.performanceId,
            ticketTypeId: t.id,
            capacity: t.capacity,
          }))
        // Сначала создаём недостающие строки, потом блокируем все в общем порядке.
        for (const k of keys)
          if (await tx.insertInventory({ ...k, sold: 0, held: 0, updatedAt: now }))
            categoriesCreated++
        const rows = keys.length ? await tx.lockInventory(keys) : []
        const conflicts: { ticketTypeId: string; capacity: number; committed: number }[] = []
        for (const k of keys) {
          const row = rows.find((r) => r.ticketTypeId === k.ticketTypeId)!
          if (row.capacity === k.capacity) continue
          if (row.sold + row.held > k.capacity)
            conflicts.push({
              ticketTypeId: k.ticketTypeId,
              capacity: k.capacity,
              committed: row.sold + row.held,
            })
          else if (await tx.setCapacity(k, k.capacity, now)) categoriesUpdated++
          else throw new InventoryInvariantError('capacity changed under lock')
        }
        if (conflicts.length) throw new BelowCommitted(conflicts)

        let seatsAdded = 0
        const seatsInUse: string[] = []
        if (spec.seating) {
          const { planId, planVersion } = spec.seating
          const blocked = new Set(spec.seating.blockedSeatIds)
          const wanted = new Map(spec.seating.seats.map((s) => [s.id, s.categoryId]))
          const existing = new Map(
            (await tx.lockSeats(spec.performanceId)).map((s) => [s.seatId, s]),
          )
          const missing: SeatRow[] = []
          for (const [seatId, categoryId] of wanted)
            if (!existing.has(seatId))
              missing.push({
                performanceId: spec.performanceId,
                seatId,
                planId,
                planVersion,
                categoryId,
                status: blocked.has(seatId) ? 'blocked' : 'free',
                holdId: null,
                orderId: null,
                updatedAt: now,
              })
          if (missing.length) await tx.insertSeats(missing)
          seatsAdded = missing.length
          for (const seat of [...existing.values()].sort((a, b) => cmp(a.seatId, b.seatId))) {
            const categoryId = wanted.get(seat.seatId)
            const shouldBlock = categoryId === undefined || blocked.has(seat.seatId)
            if (seat.status === 'held' || seat.status === 'sold') {
              if (shouldBlock || categoryId !== seat.categoryId) seatsInUse.push(seat.seatId)
              continue
            }
            if (
              categoryId !== undefined &&
              (seat.categoryId !== categoryId ||
                seat.planVersion !== planVersion ||
                seat.planId !== planId)
            )
              await tx.retagSeat(
                spec.performanceId,
                seat.seatId,
                { planId, planVersion, categoryId },
                now,
              )
            const target = shouldBlock ? 'blocked' : 'free'
            if (seat.status !== target)
              await tx.updateSeats(
                spec.performanceId,
                [seat.seatId],
                { status: seat.status },
                { status: target, holdId: null, orderId: null },
                now,
              )
          }
        }
        return { ok: true as const, categoriesCreated, categoriesUpdated, seatsAdded, seatsInUse }
      })
    } catch (error) {
      if (error instanceof BelowCommitted)
        return { ok: false, error: 'BELOW_COMMITTED', conflicts: error.conflicts }
      throw error
    }
  }

  /** Остатки показа для витрины (без блокировок; окончательно решает `acquire`). */
  async function availability(performanceId: string) {
    const [rows, seats] = await Promise.all([
      store.inventory(performanceId),
      store.seats(performanceId),
    ])
    return {
      categories: rows
        .map((r) => ({
          ticketTypeId: r.ticketTypeId,
          capacity: r.capacity,
          sold: r.sold,
          held: r.held,
          remaining: Math.max(0, r.capacity - r.sold - r.held),
        }))
        .sort((a, b) => cmp(a.ticketTypeId, b.ticketTypeId)),
      unavailableSeatIds: seats
        .filter((s) => s.status !== 'free')
        .map((s) => s.seatId)
        .sort(cmp),
    }
  }

  return { syncCapacity, availability }
}

export type InventoryService = ReturnType<typeof createInventoryService>
