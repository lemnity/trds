import { createRequire } from 'node:module'
import path from 'node:path'

import { sql } from '@payloadcms/db-postgres/drizzle'
import { drizzle } from '@payloadcms/db-postgres/drizzle/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { accountsTables } from '../../src/db/schema/accounts'
import { commerceTables } from '../../src/db/schema/commerce'
import {
  capacityFromPerformance,
  createInventoryService,
} from '../../src/modules/inventory/inventory'
import { pgCommerceStore } from '../../src/modules/inventory/pgStore'
import { createOrderService, type PlaceOrderLine } from '../../src/modules/orders/service'
import type { Performance } from '../../src/modules/shows'

/**
 * Конкурентность на настоящем PostgreSQL (T-042, T-049, ядро T-071). Запускается только
 * с COMMERCE_PG_URL — ОДНОРАЗОВАЯ база: схема public пересоздаётся. Например:
 *   docker run --rm -d --name trds-commerce-test -p 127.0.0.1:55433:5432 \
 *     -e POSTGRES_PASSWORD=x postgres:16.15-alpine
 *   COMMERCE_PG_URL=postgres://postgres:x@127.0.0.1:55433/postgres pnpm vitest run commerce-pg
 * Схема применяется тем же drizzle-kit, которым Payload строит миграции.
 */
const url = process.env.COMMERCE_PG_URL

const NOW = new Date('2026-11-20T10:00:00Z')
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)

describe.skipIf(!url)('commerce on PostgreSQL', () => {
  const db = drizzle({ connection: { connectionString: url!, max: 40 } })
  const pgStore = pgCommerceStore(db as unknown as Parameters<typeof pgCommerceStore>[0])
  // Считаем повторы после deadlock: при едином порядке блокировок их быть не должно вовсе.
  let retries = 0
  const store: typeof pgStore = {
    ...pgStore,
    isRetryable: (error) => {
      const retryable = pgStore.isRetryable(error)
      if (retryable) retries++
      return retryable
    },
  }
  const inventory = createInventoryService({ store })
  const orders = createOrderService({ store, ticketSecret: 'pg-test-ticket-secret-0123456789' })
  let seq = 0

  const place = (lines: PlaceOrderLine[], key = `pg-${++seq}`, now = NOW) =>
    orders.placeOrder(
      {
        idempotencyKey: key,
        email: 'guest@example.com',
        customerId: null,
        lines,
        bonusKopecks: 0,
        feePerTicketKopecks: 20_000,
      },
      now,
    )
  const pay = (order: { id: string; cashKopecks: number }, now = at(5), id = `pay-${order.id}`) =>
    orders.confirmPayment(
      {
        orderId: order.id,
        provider: 'bank',
        providerPaymentId: id,
        amountKopecks: order.cashKopecks,
        currency: 'RUB',
      },
      now,
    )
  const line = (performanceId: string, ticketTypeId: string, quantity = 1): PlaceOrderLine => ({
    performanceId,
    ticketTypeId,
    title: ticketTypeId,
    unitPriceKopecks: 150_000,
    quantity,
  })
  const seatLine = (performanceId: string, seatId: string, categoryId: string): PlaceOrderLine => ({
    performanceId,
    ticketTypeId: categoryId,
    seatId,
    title: seatId,
    unitPriceKopecks: 200_000,
    quantity: 1,
  })
  const row = async (performanceId: string, ticketTypeId: string) =>
    (await store.inventory(performanceId)).find((r) => r.ticketTypeId === ticketTypeId)!
  const count = async (query: ReturnType<typeof sql>) => {
    const result = await db.execute<{ n: string }>(query)
    return Number(result.rows[0]!.n)
  }
  const seated = (id: string): Performance => ({
    id,
    showSlug: 'x',
    venueId: 'dom-aktera',
    startsAt: '2026-11-23T19:00:00+05:00',
    ticketTypes: [],
    seating: { planId: 'dom-aktera', pricesKopecks: {}, unavailableSeatIds: [] },
  })

  beforeAll(async () => {
    const kit = createRequire(path.resolve('node_modules/@payloadcms/db-postgres/package.json'))(
      'drizzle-kit/api',
    ) as {
      generateDrizzleJson: (imports: Record<string, unknown>) => Promise<unknown>
      generateMigration: (prev: unknown, cur: unknown) => Promise<string[]>
    }
    const statements = await kit.generateMigration(
      await kit.generateDrizzleJson({}),
      await kit.generateDrizzleJson({ ...accountsTables, ...commerceTables }),
    )
    await db.execute(sql.raw('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'))
    for (const statement of statements) await db.execute(sql.raw(statement))
  }, 60_000)

  afterAll(async () => {
    await db.$client.end()
  })

  it('schema applies cleanly on an empty database', async () => {
    const tables = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'commerce_%' ORDER BY 1`,
    )
    expect(tables.rows.map((r) => r.table_name)).toEqual(Object.keys(commerceTables).sort())
  })

  it('50 parallel checkouts for the last 3 units: exactly 3 holds, then 3 tickets', async () => {
    await inventory.syncCapacity(
      { performanceId: 'p1', ticketTypes: [{ id: 'std', capacity: 3 }] },
      NOW,
    )
    const results = await Promise.all(Array.from({ length: 50 }, () => place([line('p1', 'std')])))
    const won = results.flatMap((r) => (r.ok ? [r.order] : []))
    expect(won).toHaveLength(3)
    expect(results.filter((r) => !r.ok && r.error === 'UNAVAILABLE')).toHaveLength(47)
    expect(await row('p1', 'std')).toMatchObject({ capacity: 3, held: 3, sold: 0 })

    // Каждый платёж дважды и параллельно (дубль webhook).
    const paid = await Promise.all(won.flatMap((o) => [pay(o), pay(o)]))
    expect(paid.every((p) => p.ok)).toBe(true)
    expect(paid.filter((p) => p.ok && !p.duplicate)).toHaveLength(3)
    expect(await row('p1', 'std')).toMatchObject({ held: 0, sold: 3 })
    expect(
      await count(sql`SELECT count(*) AS n FROM commerce_tickets WHERE performance_id = 'p1'`),
    ).toBe(3)
    expect(
      await count(sql`SELECT count(*) AS n FROM commerce_outbox WHERE kind = 'order.paid'`),
    ).toBe(3)
  })

  it('40 buyers for one seat: one hold, one ticket', async () => {
    await inventory.syncCapacity(capacityFromPerformance(seated('da1')), NOW)
    const results = await Promise.all(
      Array.from({ length: 40 }, () => place([seatLine('da1', 'r5-s7', 'cat-4')])),
    )
    const won = results.flatMap((r) => (r.ok ? [r.order] : []))
    expect(won).toHaveLength(1)
    await Promise.all([pay(won[0]!), pay(won[0]!)])
    expect(
      await count(
        sql`SELECT count(*) AS n FROM commerce_tickets WHERE performance_id = 'da1' AND seat_id = 'r5-s7'`,
      ),
    ).toBe(1)
    const seat = (await store.seats('da1')).find((s) => s.seatId === 'r5-s7')
    expect(seat).toMatchObject({ status: 'sold', holdId: null, orderId: won[0]!.id })
  })

  it('storefront batch: availabilityOf reads p1 and da1 in one pass (sold + taken seats)', async () => {
    // После двух тестов выше: p1 распродан (3 из 3), на da1 продано место r5-s7.
    const stock = await inventory.availabilityOf(['p1', 'da1', 'never-synced'])
    expect(stock.get('p1')?.categories).toEqual([
      { ticketTypeId: 'std', capacity: 3, sold: 3, held: 0, remaining: 0 },
    ])
    expect(stock.get('da1')?.unavailableSeatIds).toEqual(['r5-s7'])
    expect(stock.has('never-synced')).toBe(false)
    expect((await inventory.availabilityOf([])).size).toBe(0)
  })

  it('crossing multi-line orders over seats and categories do not deadlock or oversell', async () => {
    await inventory.syncCapacity(
      {
        performanceId: 'p2',
        ticketTypes: [
          { id: 'a', capacity: 10 },
          { id: 'b', capacity: 10 },
        ],
      },
      NOW,
    )
    await inventory.syncCapacity(capacityFromPerformance(seated('da2')), NOW)
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        place(
          i % 2
            ? [
                line('p2', 'a'),
                line('p2', 'b'),
                seatLine('da2', 'r8-s1', 'cat-5'),
                seatLine('da2', 'r8-s2', 'cat-5'),
              ]
            : [
                seatLine('da2', 'r8-s2', 'cat-5'),
                line('p2', 'b'),
                seatLine('da2', 'r8-s1', 'cat-5'),
                line('p2', 'a'),
              ],
        ),
      ),
    )
    // Все запросы завершились ответом (ни один не упал deadlock'ом), выиграл ровно один — места.
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(await row('p2', 'a')).toMatchObject({ held: 1 })
    expect(await row('p2', 'b')).toMatchObject({ held: 1 })

    const many = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        place(i % 2 ? [line('p2', 'a'), line('p2', 'b')] : [line('p2', 'b'), line('p2', 'a')]),
      ),
    )
    expect(many.filter((r) => r.ok)).toHaveLength(9)
    expect(await row('p2', 'a')).toMatchObject({ held: 10, capacity: 10 })
    expect(await row('p2', 'b')).toMatchObject({ held: 10, capacity: 10 })
  })

  it('same idempotency key in parallel creates one order and one hold', async () => {
    await inventory.syncCapacity(
      { performanceId: 'p3', ticketTypes: [{ id: 'std', capacity: 10 }] },
      NOW,
    )
    const results = await Promise.all(
      Array.from({ length: 10 }, () => place([line('p3', 'std', 2)], 'same-key')),
    )
    const ids = new Set(results.map((r) => (r.ok ? r.order.id : r.error)))
    expect(ids.size).toBe(1)
    expect(results.filter((r) => r.ok && !r.duplicate)).toHaveLength(1)
    expect(await row('p3', 'std')).toMatchObject({ held: 2 })
  })

  it('parallel expiry workers release each hold exactly once; capacity sync refuses going below', async () => {
    await inventory.syncCapacity(
      { performanceId: 'p4', ticketTypes: [{ id: 'std', capacity: 20 }] },
      NOW,
    )
    const placed = await Promise.all(Array.from({ length: 12 }, () => place([line('p4', 'std')])))
    expect(placed.every((p) => p.ok)).toBe(true)
    expect(
      await inventory.syncCapacity(
        { performanceId: 'p4', ticketTypes: [{ id: 'std', capacity: 11 }] },
        NOW,
      ),
    ).toMatchObject({ ok: false, error: 'BELOW_COMMITTED' })
    const runs = await Promise.all(Array.from({ length: 4 }, () => orders.expireHolds(at(16))))
    // В этой базе висят и брони из других тестов этого файла — считаем только p4.
    expect(runs.reduce((s, r) => s + r.expired, 0)).toBeGreaterThanOrEqual(12)
    expect(await row('p4', 'std')).toMatchObject({ held: 0, sold: 0, capacity: 20 })
    expect(
      await count(
        sql`SELECT count(*) AS n FROM commerce_holds h JOIN commerce_order_items i ON i.order_id = h.order_id WHERE i.performance_id = 'p4' AND h.status = 'EXPIRED'`,
      ),
    ).toBe(12)
  })

  it('late payment: re-acquired if stock remains, otherwise NEEDS_REVIEW — never above capacity', async () => {
    await inventory.syncCapacity(
      { performanceId: 'p5', ticketTypes: [{ id: 'std', capacity: 1 }] },
      NOW,
    )
    const first = await place([line('p5', 'std')])
    if (!first.ok) throw new Error(first.error)
    await orders.expireHolds(at(16))
    const second = await place([line('p5', 'std')], undefined, at(17))
    if (!second.ok) throw new Error(second.error)
    // Поздняя оплата первого и обычная второго — одновременно.
    const [late, normal] = await Promise.all([pay(first.order, at(18)), pay(second.order, at(18))])
    expect(normal).toMatchObject({ ok: true, late: false })
    expect(late).toMatchObject({
      ok: false,
      error: 'NEEDS_REVIEW',
      reason: 'LATE_PAYMENT_NO_STOCK',
    })
    expect(await row('p5', 'std')).toMatchObject({ capacity: 1, sold: 1, held: 0 })
    expect((await store.order(first.order.id))?.status).toBe('NEEDS_REVIEW')
  })

  it('payment racing expiry, 10 rounds: one ticket each time, capacity respected', async () => {
    for (let round = 0; round < 10; round++) {
      const perf = `race-${round}`
      await inventory.syncCapacity(
        { performanceId: perf, ticketTypes: [{ id: 'std', capacity: 1 }] },
        NOW,
      )
      const placed = await place([line(perf, 'std')])
      if (!placed.ok) throw new Error(placed.error)
      const [paid] = await Promise.all([
        pay(placed.order, at(16)),
        orders.expireHolds(at(16)),
        orders.expireHolds(at(16)),
      ])
      expect(paid.ok).toBe(true)
      expect(await row(perf, 'std')).toMatchObject({ held: 0, sold: 1 })
      expect(
        await count(sql`SELECT count(*) AS n FROM commerce_tickets WHERE performance_id = ${perf}`),
      ).toBe(1)
    }
  })

  it('database constraints reject what the code must never do', async () => {
    const rejects = async (query: ReturnType<typeof sql>, constraint: string) => {
      let error: unknown
      try {
        await db.execute(query)
      } catch (e) {
        error = e
      }
      const text = String((error as { cause?: unknown })?.cause ?? error)
      expect(text).toContain(constraint)
    }
    await rejects(
      sql`UPDATE commerce_inventory SET held = capacity - sold + 1 WHERE performance_id = 'p3'`,
      'commerce_inventory_within_capacity',
    )
    await rejects(
      sql`UPDATE commerce_orders SET cash_kopecks = cash_kopecks + 1 WHERE status = 'PAID'`,
      'commerce_orders_cash_formula',
    )
    await rejects(
      sql`INSERT INTO commerce_tickets SELECT gen_random_uuid(), number || '-dup', order_id, order_item_id, performance_id, ticket_type_id, seat_id, md5(random()::text), token_version, status, price_kopecks, bonus_kopecks, cash_kopecks, fee_kopecks, issued_at, refunded_at FROM commerce_tickets WHERE seat_id = 'r5-s7'`,
      'commerce_tickets_seat_live_uq',
    )
    await rejects(
      sql`UPDATE commerce_seats SET status = 'held' WHERE performance_id = 'da1' AND seat_id = 'r1-s1'`,
      'commerce_seats_hold_shape',
    )
  })

  it('no transaction hit a deadlock: lock order is deterministic everywhere', () => {
    expect(retries).toBe(0)
  })
})
