import { describe, expect, it } from 'vitest'

import {
  createInventoryService,
  capacityFromPerformance,
} from '../../src/modules/inventory/inventory'
import { memoryCommerceStore } from '../../src/modules/inventory/memoryStore'
import { TX_ATTEMPTS } from '../../src/modules/inventory/retry'
import { createOrderService, type PlaceOrderLine } from '../../src/modules/orders/service'
import { domAkteraPlan, seatsOf } from '../../src/modules/seating'
import type { Performance } from '../../src/modules/shows'

const SECRET = 'ticket-secret-ticket-secret-123456'
const NOW = new Date('2026-11-20T10:00:00Z')
const MIN = 60_000
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MIN)

const setup = (store = memoryCommerceStore()) => ({
  store,
  inventory: createInventoryService({ store }),
  orders: createOrderService({
    store,
    ticketSecret: SECRET,
    retry: { sleep: async () => undefined },
  }),
})

const std = (quantity: number, performanceId = 'p1'): PlaceOrderLine => ({
  performanceId,
  ticketTypeId: 'std',
  title: 'Входной',
  unitPriceKopecks: 150_000,
  quantity,
})
const vip = (quantity: number): PlaceOrderLine => ({
  performanceId: 'p1',
  ticketTypeId: 'vip',
  title: 'Столик',
  unitPriceKopecks: 250_050,
  quantity,
})
const seat = (seatId: string, categoryId = 'cat-1'): PlaceOrderLine => ({
  performanceId: 'da1',
  ticketTypeId: categoryId,
  seatId,
  title: `Место ${seatId}`,
  unitPriceKopecks: 200_000,
  quantity: 1,
})

let keySeq = 0
const place = (
  orders: ReturnType<typeof setup>['orders'],
  lines: PlaceOrderLine[],
  extra: { key?: string; bonus?: number; now?: Date } = {},
) =>
  orders.placeOrder(
    {
      idempotencyKey: extra.key ?? `k-${++keySeq}`,
      email: 'Guest@Example.com',
      customerId: null,
      lines,
      bonusKopecks: extra.bonus ?? 0,
      feePerTicketKopecks: 20_000,
    },
    extra.now ?? NOW,
  )

const pay = (
  orders: ReturnType<typeof setup>['orders'],
  order: { id: string; cashKopecks: number },
  now = at(5),
  paymentId = `pay-${order.id}`,
) =>
  orders.confirmPayment(
    {
      orderId: order.id,
      provider: 'bank',
      providerPaymentId: paymentId,
      amountKopecks: order.cashKopecks,
      currency: 'RUB',
    },
    now,
  )

const syncP1 = (inventory: ReturnType<typeof setup>['inventory'], std = 5, vip = 2) =>
  inventory.syncCapacity(
    {
      performanceId: 'p1',
      ticketTypes: [
        { id: 'std', capacity: std },
        { id: 'vip', capacity: vip },
      ],
    },
    NOW,
  )

const daPerformance: Performance = {
  id: 'da1',
  showSlug: 'x',
  venueId: 'dom-aktera',
  startsAt: '2026-11-23T19:00:00+05:00',
  ticketTypes: [],
  seating: { planId: 'dom-aktera', pricesKopecks: {}, unavailableSeatIds: ['r12-s9'] },
}

const invRow = (store: ReturnType<typeof memoryCommerceStore>, ticketTypeId: string) =>
  store.dump().inventory.find((r) => r.ticketTypeId === ticketTypeId)!

describe('syncCapacity', () => {
  it('creates rows, is idempotent, and refuses lowering below sold + held', async () => {
    const { store, inventory, orders } = setup()
    expect(await syncP1(inventory)).toEqual({
      ok: true,
      categoriesCreated: 2,
      categoriesUpdated: 0,
      seatsAdded: 0,
      seatsInUse: [],
    })
    expect(await syncP1(inventory)).toMatchObject({ categoriesCreated: 0, categoriesUpdated: 0 })

    const placed = await place(orders, [std(3)])
    expect(placed.ok).toBe(true)
    expect(await syncP1(inventory, 2, 1)).toEqual({
      ok: false,
      error: 'BELOW_COMMITTED',
      conflicts: [{ ticketTypeId: 'std', capacity: 2, committed: 3 }],
    })
    // Отказ целиком: vip тоже не изменился.
    expect(invRow(store, 'vip').capacity).toBe(2)
    expect(await syncP1(inventory, 3, 1)).toMatchObject({ ok: true, categoriesUpdated: 2 })
    expect(invRow(store, 'std')).toMatchObject({ capacity: 3, held: 3, sold: 0 })
    await expect(
      inventory.syncCapacity({ performanceId: 'p1', ticketTypes: [{ id: 'std', capacity: -1 }] }),
    ).rejects.toThrow(RangeError)
  })

  it('seat plan: adds 136 seats of Dom aktera, blocks unavailable, keeps taken seats', async () => {
    const { store, inventory, orders } = setup()
    const spec = capacityFromPerformance(daPerformance)
    expect(spec.seating?.seats).toHaveLength(seatsOf(domAkteraPlan).length)
    expect(await inventory.syncCapacity(spec, NOW)).toMatchObject({ ok: true, seatsAdded: 136 })
    expect(await inventory.syncCapacity(spec, NOW)).toMatchObject({ ok: true, seatsAdded: 0 })
    expect((await inventory.availability('da1')).unavailableSeatIds).toEqual(['r12-s9'])

    expect((await place(orders, [seat('r1-s1')])).ok).toBe(true)
    // Театр закрыл r1-s1 и открыл r12-s9: занятое место не трогаем, о нём сообщаем.
    const result = await inventory.syncCapacity(
      { ...spec, seating: { ...spec.seating!, blockedSeatIds: ['r1-s1'] } },
      NOW,
    )
    expect(result).toMatchObject({ ok: true, seatsInUse: ['r1-s1'] })
    const seats = store.dump().seats
    expect(seats.find((s) => s.seatId === 'r1-s1')?.status).toBe('held')
    expect(seats.find((s) => s.seatId === 'r12-s9')?.status).toBe('free')
  })
})

describe('placeOrder: hold', () => {
  it('holds categories atomically, snapshots prices and splits bonus over items', async () => {
    const { store, inventory, orders } = setup()
    await syncP1(inventory)
    const result = await place(orders, [std(2), vip(1)], { bonus: 100_000 })
    if (!result.ok) throw new Error(result.error)
    const { order, items } = result
    expect(order).toMatchObject({
      status: 'PENDING_PAYMENT',
      email: 'guest@example.com',
      grossKopecks: 550_050,
      bonusKopecks: 100_000,
      feeKopecks: 60_000,
      cashKopecks: 550_050 - 100_000 + 60_000,
      holdUntil: at(15),
    })
    expect(order.number).toMatch(/^TRD-[2-9A-Z]{8}$/)
    expect(items.map((i) => [i.lineGrossKopecks, i.lineBonusKopecks, i.lineCashKopecks])).toEqual([
      [300_000, 54_540, 245_460],
      [250_050, 45_460, 204_590],
    ])
    expect(await inventory.availability('p1')).toMatchObject({
      categories: [
        { ticketTypeId: 'std', held: 2, remaining: 3 },
        { ticketTypeId: 'vip', held: 1, remaining: 1 },
      ],
    })
    expect(store.dump().holds).toMatchObject([{ status: 'ACTIVE', expiresAt: at(15) }])
    expect(store.dump().audit.map((a) => a.action)).toEqual(['order.placed'])
  })

  it('all-or-nothing: one line sold out → nothing held, no order', async () => {
    const { store, inventory, orders } = setup()
    await syncP1(inventory)
    const result = await place(orders, [std(2), vip(3)])
    expect(result).toEqual({
      ok: false,
      error: 'UNAVAILABLE',
      unavailable: [
        {
          performanceId: 'p1',
          ticketTypeId: 'vip',
          seatId: null,
          reason: 'SOLD_OUT',
          remaining: 2,
        },
      ],
    })
    const dump = store.dump()
    expect(dump.orders).toHaveLength(0)
    expect(dump.holds).toHaveLength(0)
    expect(dump.inventory.every((r) => r.held === 0)).toBe(true)
    expect(await place(orders, [std(1, 'unknown')])).toMatchObject({
      error: 'UNAVAILABLE',
      unavailable: [{ reason: 'NOT_ON_SALE' }],
    })
  })

  it('rejects inconsistent input before touching the store', async () => {
    const { inventory, orders } = setup()
    await syncP1(inventory)
    await expect(place(orders, [std(1)], { bonus: 150_001 })).rejects.toThrow(RangeError)
    await expect(place(orders, [std(11)])).rejects.toThrow(RangeError)
    await expect(place(orders, [{ ...std(1), unitPriceKopecks: 10.5 }])).rejects.toThrow(RangeError)
    await expect(place(orders, [])).rejects.toThrow(RangeError)
    await expect(place(orders, [{ ...seat('r1-s1'), quantity: 2 }])).rejects.toThrow(RangeError)
  })

  it('idempotency: same key returns the same order, different content is a conflict', async () => {
    const { store, inventory, orders } = setup()
    await syncP1(inventory)
    const [a, b] = await Promise.all([
      place(orders, [std(2)], { key: 'same' }),
      place(orders, [std(2)], { key: 'same' }),
    ])
    if (!a.ok || !b.ok) throw new Error('expected ok')
    expect(a.order.id).toBe(b.order.id)
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true])
    expect(invRow(store, 'std').held).toBe(2)
    expect(await place(orders, [std(3)], { key: 'same' })).toEqual({
      ok: false,
      error: 'IDEMPOTENCY_CONFLICT',
    })
    expect(store.dump().orders).toHaveLength(1)
  })

  it('seats: wrong category is rejected (price tampering), taken seat is rejected', async () => {
    const { inventory, orders } = setup()
    await inventory.syncCapacity(capacityFromPerformance(daPerformance), NOW)
    expect(await place(orders, [seat('r1-s1', 'cat-7')])).toMatchObject({
      error: 'UNAVAILABLE',
      unavailable: [{ reason: 'CATEGORY_MISMATCH' }],
    })
    expect(await place(orders, [seat('r12-s9', 'cat-7')])).toMatchObject({
      unavailable: [{ reason: 'SEAT_TAKEN' }],
    })
    expect((await place(orders, [seat('r1-s1'), seat('r1-s2')])).ok).toBe(true)
    expect(await place(orders, [seat('r1-s3'), seat('r1-s2')])).toMatchObject({
      unavailable: [{ seatId: 'r1-s2', reason: 'SEAT_TAKEN' }],
    })
  })
})

describe('concurrency (memory store models row locks)', () => {
  it('N parallel checkouts on the last units never exceed capacity', async () => {
    const { store, inventory, orders } = setup()
    await syncP1(inventory, 5)
    const results = await Promise.all(Array.from({ length: 30 }, () => place(orders, [std(1)])))
    expect(results.filter((r) => r.ok)).toHaveLength(5)
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.error === 'UNAVAILABLE')).toBe(true)
    expect(invRow(store, 'std')).toMatchObject({ held: 5, sold: 0, capacity: 5 })
    expect(store.dump().orders).toHaveLength(5)
  })

  it('the test is sensitive: without locks and conditional updates it oversells', async () => {
    const { store, inventory, orders } = setup(
      memoryCommerceStore({ noLocks: true, noGuards: true, noChecks: true }),
    )
    await syncP1(inventory, 5)
    const results = await Promise.all(Array.from({ length: 30 }, () => place(orders, [std(1)])))
    expect(results.filter((r) => r.ok).length).toBeGreaterThan(5)
    expect(store.dump().orders.length).toBeGreaterThan(5)
  })

  it('one seat, many buyers: exactly one hold, then exactly one ticket', async () => {
    const { store, inventory, orders } = setup()
    await inventory.syncCapacity(capacityFromPerformance(daPerformance), NOW)
    const results = await Promise.all(
      Array.from({ length: 20 }, () => place(orders, [seat('r3-s5', 'cat-3')])),
    )
    const won = results.filter((r) => r.ok)
    expect(won).toHaveLength(1)
    if (!won[0]?.ok) throw new Error('no winner')
    const paid = await Promise.all([pay(orders, won[0].order), pay(orders, won[0].order)])
    expect(paid.map((p) => p.ok && p.duplicate).sort()).toEqual([false, true])
    expect(store.dump().tickets.filter((t) => t.seatId === 'r3-s5')).toHaveLength(1)
    expect(store.dump().seats.find((s) => s.seatId === 'r3-s5')).toMatchObject({
      status: 'sold',
      holdId: null,
      orderId: won[0].order.id,
    })
  })

  it('crossing multi-line orders (std+vip vs vip+std) do not deadlock', async () => {
    const { store, inventory, orders } = setup()
    await syncP1(inventory, 10, 10)
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        place(orders, i % 2 ? [std(1), vip(1)] : [vip(1), std(1)]),
      ),
    )
    expect(results.filter((r) => r.ok)).toHaveLength(10)
    expect(invRow(store, 'std').held).toBe(10)
    expect(invRow(store, 'vip').held).toBe(10)
  })

  it('bounded retry: transient deadlock is retried, persistent failure surfaces', async () => {
    const { store, inventory, orders } = setup()
    await syncP1(inventory)
    store.failNextTransactions(TX_ATTEMPTS - 1)
    expect((await place(orders, [std(1)])).ok).toBe(true)
    store.failNextTransactions(TX_ATTEMPTS)
    await expect(place(orders, [std(1)])).rejects.toThrow(/deadlock/)
    store.failNextTransactions(0)
    expect(invRow(store, 'std').held).toBe(1)
  })
})

describe('confirmPayment', () => {
  it('commits the hold, issues tickets with bonus shares, enqueues one email', async () => {
    const { store, inventory, orders } = setup()
    await syncP1(inventory)
    const placed = await place(orders, [std(2), vip(1)], { bonus: 100_000 })
    if (!placed.ok) throw new Error(placed.error)
    const result = await pay(orders, placed.order)
    if (!result.ok) throw new Error(result.error)
    expect(result).toMatchObject({ status: 'PAID', duplicate: false, late: false })
    expect(result.tickets).toHaveLength(3)
    expect(result.tickets.reduce((s, t) => s + t.bonusKopecks, 0)).toBe(100_000)
    expect(result.tickets.reduce((s, t) => s + t.cashKopecks + t.feeKopecks, 0)).toBe(
      placed.order.cashKopecks,
    )
    expect(new Set(result.tickets.map((t) => t.number))).toEqual(
      new Set([1, 2, 3].map((n) => `${placed.order.number}-0${n}`)),
    )
    // В БД — только хеш токена; сам токен восстанавливается из секрета для QR.
    const t = result.tickets[0]!
    const token = orders.ticketToken(t)
    expect(t.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(store.dump())).not.toContain(token)

    const dump = store.dump()
    expect(invRow(store, 'std')).toMatchObject({ held: 0, sold: 2 })
    expect(invRow(store, 'vip')).toMatchObject({ held: 0, sold: 1 })
    expect(dump.holds[0]?.status).toBe('COMMITTED')
    expect(dump.orders[0]).toMatchObject({
      status: 'PAID',
      paidAt: at(5),
      holdUntil: null,
      paymentProvider: 'bank',
    })
    expect(dump.outbox.map((o) => [o.kind, o.payload])).toEqual([
      ['order.paid', { orderId: placed.order.id, orderNumber: placed.order.number }],
    ])

    // Дубль webhook: ни билетов, ни писем, ни продаж сверх.
    const again = await pay(orders, placed.order)
    expect(again).toMatchObject({ ok: true, duplicate: true })
    expect(store.dump().tickets).toHaveLength(3)
    expect(store.dump().outbox).toHaveLength(1)
    expect(invRow(store, 'std').sold).toBe(2)
  })

  it('wrong amount or currency: no tickets, needs review, hold released', async () => {
    const { store, inventory, orders } = setup()
    await syncP1(inventory)
    const placed = await place(orders, [std(2)])
    if (!placed.ok) throw new Error(placed.error)
    const result = await orders.confirmPayment(
      {
        orderId: placed.order.id,
        provider: 'bank',
        providerPaymentId: 'p-1',
        amountKopecks: placed.order.cashKopecks - 1,
        currency: 'RUB',
      },
      at(5),
    )
    expect(result).toMatchObject({ ok: false, error: 'NEEDS_REVIEW', reason: 'AMOUNT_MISMATCH' })
    expect(store.dump().tickets).toHaveLength(0)
    expect(invRow(store, 'std')).toMatchObject({ held: 0, sold: 0 })
    expect(store.dump().outbox.map((o) => o.kind)).toEqual(['order.needs_review'])

    const other = await place(orders, [std(1)])
    if (!other.ok) throw new Error(other.error)
    expect(
      await orders.confirmPayment(
        {
          orderId: other.order.id,
          provider: 'bank',
          providerPaymentId: 'p-2',
          amountKopecks: other.order.cashKopecks,
          currency: 'USD',
        },
        at(5),
      ),
    ).toMatchObject({ error: 'NEEDS_REVIEW', reason: 'CURRENCY_MISMATCH' })
  })

  it('a second, different payment for a paid order is flagged, not ticketed', async () => {
    const { store, inventory, orders } = setup()
    await syncP1(inventory)
    const placed = await place(orders, [std(1)])
    if (!placed.ok) throw new Error(placed.error)
    await pay(orders, placed.order, at(5), 'first')
    expect(await pay(orders, placed.order, at(6), 'second')).toEqual({
      ok: false,
      error: 'DUPLICATE_PAYMENT',
    })
    expect(store.dump().tickets).toHaveLength(1)
    expect(store.dump().outbox.map((o) => o.kind)).toEqual(['order.paid', 'payment.duplicate'])
    expect(
      await orders.confirmPayment({
        orderId: 'nope',
        provider: 'bank',
        providerPaymentId: 'x',
        amountKopecks: 1,
        currency: 'RUB',
      }),
    ).toEqual({ ok: false, error: 'NOT_FOUND' })
  })
})

describe('cancel and expiry (T-048)', () => {
  it('cancel releases the hold once', async () => {
    const { store, inventory, orders } = setup()
    await syncP1(inventory)
    const placed = await place(orders, [std(2)])
    if (!placed.ok) throw new Error(placed.error)
    const cancel = () =>
      orders.cancelOrder(placed.order.id, { actor: 'customer', reason: 'передумал' }, at(1))
    expect(await cancel()).toEqual({ ok: true, duplicate: false })
    expect(await cancel()).toEqual({ ok: true, duplicate: true })
    expect(invRow(store, 'std').held).toBe(0)
    expect(store.dump().holds[0]?.status).toBe('RELEASED')
  })

  it('expireHolds: only overdue, idempotent, parallel workers release each hold once', async () => {
    const { store, inventory, orders } = setup()
    await syncP1(inventory, 5, 2)
    const placed = await Promise.all([
      place(orders, [std(2)]),
      place(orders, [std(1), vip(1)]),
      place(orders, [vip(1)], { now: at(10) }),
    ])
    expect(placed.every((p) => p.ok)).toBe(true)
    expect(await orders.expireHolds(at(14))).toEqual({ expired: 0, confirmed: 0, skipped: 0 })

    const runs = await Promise.all([
      orders.expireHolds(at(16)),
      orders.expireHolds(at(16)),
      orders.expireHolds(at(16)),
    ])
    expect(runs.reduce((s, r) => s + r.expired, 0)).toBe(2)
    expect(invRow(store, 'std').held).toBe(0)
    expect(invRow(store, 'vip').held).toBe(1)
    expect(await orders.expireHolds(at(16))).toMatchObject({ expired: 0 })
    expect(await orders.expireHolds(at(30))).toMatchObject({ expired: 1 })
    expect(store.dump().orders.map((o) => o.status)).toEqual(['EXPIRED', 'EXPIRED', 'EXPIRED'])
    expect(store.dump().inventory.every((r) => r.held === 0 && r.sold === 0)).toBe(true)
  })

  it('payment that lands in the hold window but after hold_until still sells from the hold', async () => {
    const { store, inventory, orders } = setup()
    await syncP1(inventory, 1)
    const placed = await place(orders, [std(1)])
    if (!placed.ok) throw new Error(placed.error)
    // Worker ещё не дошёл: бронь на месте, продаём из неё.
    expect(await pay(orders, placed.order, at(20))).toMatchObject({ ok: true, late: false })
    expect(await orders.expireHolds(at(21))).toMatchObject({ expired: 0 })
    expect(invRow(store, 'std')).toMatchObject({ held: 0, sold: 1 })
  })

  it('late payment after release: re-acquires stock when available', async () => {
    const { store, inventory, orders } = setup()
    await syncP1(inventory, 2)
    const placed = await place(orders, [std(2)])
    if (!placed.ok) throw new Error(placed.error)
    await orders.expireHolds(at(16))
    const result = await pay(orders, placed.order, at(20))
    expect(result).toMatchObject({ ok: true, status: 'PAID', late: true })
    expect(invRow(store, 'std')).toMatchObject({ held: 0, sold: 2 })
    expect(store.dump().tickets).toHaveLength(2)
    expect(store.dump().audit.map((a) => a.action)).toContain('order.late_payment_allocated')
  })

  it('late payment after release with no stock left: needs review + refund task, never oversold', async () => {
    const { store, inventory, orders } = setup()
    await syncP1(inventory, 1)
    const first = await place(orders, [std(1)])
    if (!first.ok) throw new Error(first.error)
    await orders.expireHolds(at(16))
    const second = await place(orders, [std(1)], { now: at(17) })
    if (!second.ok) throw new Error(second.error)
    expect(await pay(orders, second.order, at(18))).toMatchObject({ ok: true, late: false })

    const late = await pay(orders, first.order, at(19))
    expect(late).toMatchObject({
      ok: false,
      error: 'NEEDS_REVIEW',
      reason: 'LATE_PAYMENT_NO_STOCK',
      unavailable: [{ reason: 'SOLD_OUT', remaining: 0 }],
    })
    expect(invRow(store, 'std')).toMatchObject({ capacity: 1, sold: 1, held: 0 })
    expect(store.dump().tickets).toHaveLength(1)
    expect(store.dump().orders.find((o) => o.id === first.order.id)).toMatchObject({
      status: 'NEEDS_REVIEW',
      reviewReason: 'LATE_PAYMENT_NO_STOCK',
      providerPaymentId: `pay-${first.order.id}`,
    })
    expect(store.dump().outbox.filter((o) => o.kind === 'order.needs_review')).toHaveLength(1)
    // Повтор webhook — тот же ответ, без новых задач.
    expect(await pay(orders, first.order, at(20))).toMatchObject({
      error: 'NEEDS_REVIEW',
      duplicate: true,
    })
    expect(store.dump().outbox.filter((o) => o.kind === 'order.needs_review')).toHaveLength(1)
  })

  it('late payment for a seat resold to someone else goes to review; seat sold once', async () => {
    const { store, inventory, orders } = setup()
    await inventory.syncCapacity(capacityFromPerformance(daPerformance), NOW)
    const first = await place(orders, [seat('r2-s4', 'cat-2')])
    if (!first.ok) throw new Error(first.error)
    await orders.expireHolds(at(16))
    const second = await place(orders, [seat('r2-s4', 'cat-2')], { now: at(17) })
    if (!second.ok) throw new Error(second.error)
    await pay(orders, second.order, at(18))
    expect(await pay(orders, first.order, at(19))).toMatchObject({
      error: 'NEEDS_REVIEW',
      unavailable: [{ seatId: 'r2-s4', reason: 'SEAT_TAKEN' }],
    })
    expect(store.dump().tickets.filter((t) => t.seatId === 'r2-s4')).toHaveLength(1)
  })

  it('payment racing the expiry worker: whichever wins, capacity holds and tickets issue once', async () => {
    for (let round = 0; round < 10; round++) {
      const { store, inventory, orders } = setup()
      await syncP1(inventory, 1)
      const placed = await place(orders, [std(1)])
      if (!placed.ok) throw new Error(placed.error)
      const [paid] = await Promise.all([
        pay(orders, placed.order, at(16)),
        orders.expireHolds(at(16)),
        orders.expireHolds(at(16)),
      ])
      expect(paid.ok).toBe(true)
      expect(invRow(store, 'std')).toMatchObject({ held: 0, sold: 1 })
      expect(store.dump().tickets).toHaveLength(1)
    }
  })

  it('verify hook: paid → confirmed, pending → waits up to the grace period, error → waits', async () => {
    const { store, inventory, orders } = setup()
    await syncP1(inventory, 5)
    const [a, b, c] = await Promise.all([
      place(orders, [std(1)]),
      place(orders, [std(1)]),
      place(orders, [std(1)]),
    ])
    if (!a?.ok || !b?.ok || !c?.ok) throw new Error('place failed')
    const verify = async (order: { id: string; cashKopecks: number }) => {
      if (order.id === a.order.id)
        return {
          status: 'succeeded' as const,
          provider: 'bank',
          providerPaymentId: 'pa',
          amountKopecks: order.cashKopecks,
          currency: 'RUB',
        }
      if (order.id === b.order.id) return { status: 'pending' as const }
      throw new Error('provider timeout')
    }
    expect(await orders.expireHolds(at(16), { verify })).toEqual({
      expired: 0,
      confirmed: 1,
      skipped: 2,
    })
    expect(await orders.expireHolds(at(40), { verify })).toEqual({
      expired: 2,
      confirmed: 0,
      skipped: 0,
    })
    expect(
      store
        .dump()
        .orders.map((o) => o.status)
        .sort(),
    ).toEqual(['EXPIRED', 'EXPIRED', 'PAID'])
    expect(invRow(store, 'std')).toMatchObject({ held: 0, sold: 1 })
  })
})

describe('payment events', () => {
  it('deduplicates by provider + event id', async () => {
    const { store, orders } = setup()
    const event = {
      provider: 'bank',
      providerPaymentId: 'pay-1',
      eventId: 'evt-1',
      eventType: 'payment.succeeded',
      payload: { status: 'succeeded', amountKopecks: 100, currency: 'RUB' },
    }
    const results = await Promise.all([
      orders.recordPaymentEvent(event, NOW),
      orders.recordPaymentEvent(event, NOW),
    ])
    expect(results.map((r) => r.duplicate).sort()).toEqual([false, true])
    expect(await orders.recordPaymentEvent({ ...event, provider: 'other' }, NOW)).toEqual({
      duplicate: false,
    })
    expect(store.dump().paymentEvents).toHaveLength(2)
  })
})
