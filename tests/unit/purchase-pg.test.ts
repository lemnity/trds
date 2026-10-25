import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'

import { sql } from '@payloadcms/db-postgres/drizzle'
import { drizzle } from '@payloadcms/db-postgres/drizzle/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { accountsTables } from '../../src/db/schema/accounts'
import { commerceTables } from '../../src/db/schema/commerce'
import { walletTables } from '../../src/db/schema/wallet'
import { createLogger } from '../../src/lib/log'
import { createInventoryService } from '../../src/modules/inventory/inventory'
import { pgCommerceStore } from '../../src/modules/inventory/pgStore'
import { createPurchaseService } from '../../src/modules/orders/purchase'
import {
  HOLD_TTL_MS,
  PENDING_PAYMENT_GRACE_MS,
  createOrderService,
} from '../../src/modules/orders/service'
import { createFakeProvider, fakeBankState } from '../../src/modules/payments'
import type { SalePerformance } from '../../src/modules/shows'
import { pgWalletStore } from '../../src/modules/wallet/pgStore'
import { createWalletService } from '../../src/modules/wallet/service'

/**
 * Покупка на настоящем PostgreSQL (T-044, T-045, T-061): оформление, списание и компенсация
 * бонусов, параллельные дубли webhook вместе со сверкой, поздняя оплата. Только с PURCHASE_PG_URL —
 * ОДНОРАЗОВАЯ база: схема public пересоздаётся. Например:
 *   docker run --rm -d --name trds-purchase-test -p 127.0.0.1:55437:5432 \
 *     -e POSTGRES_PASSWORD=x postgres:16.15-alpine
 *   PURCHASE_PG_URL=postgres://postgres:x@127.0.0.1:55437/postgres pnpm vitest run purchase-pg
 */
const url = process.env.PURCHASE_PG_URL

const NOW = new Date('2026-11-20T10:00:00Z')
const MIN = 60_000

describe.skipIf(!url)('purchase on PostgreSQL', () => {
  const db = drizzle({ connection: { connectionString: url!, max: 30 } })
  const store = pgCommerceStore(db as unknown as Parameters<typeof pgCommerceStore>[0])
  const walletStore = pgWalletStore(db as unknown as Parameters<typeof pgWalletStore>[0])
  let clock = NOW
  const now = () => clock
  const orders = createOrderService({ store, ticketSecret: 'pg-ticket-secret' })
  const wallet = createWalletService({ store: walletStore, secret: 'pg-wallet-secret-0123456789' })
  const bankState = fakeBankState()
  const fake = createFakeProvider({ secret: 'pg-fake-bank', state: bankState, now })
  const purchase = createPurchaseService({
    orders,
    inventory: createInventoryService({ store }),
    stock: store,
    wallet,
    provider: fake.provider,
    statusSecret: 'pg-status',
    log: createLogger({ write: () => {} }),
    now,
    call: { sleep: async () => {} },
    allowPlaceholderPrices: true,
  })

  const performance = (id: string, capacity: number) =>
    ({
      id,
      startsAt: '2026-11-23T19:00:00+05:00',
      show: { slug: 'besy', title: 'Бесы' },
      venue: { id: 'loft', title: 'Лофт', address: '—', kind: 'loft' },
      ticketTypes: [{ id: 'std', title: 'Стандарт', priceKopecks: 150_000, capacity }],
      seating: null,
    }) as unknown as SalePerformance

  const customer = async (rubles = 0) => {
    const id = randomUUID()
    await db.execute(
      sql`INSERT INTO accounts_customers (id, email, created_at) VALUES (${id}, ${`${id}@example.com`}, ${NOW})`,
    )
    if (rubles > 0) {
      const [cert] = await wallet.issueCertificates(
        { amountKopecks: rubles * 100, count: 1, issuedBy: 'pg' },
        now(),
      )
      expect((await wallet.activateCertificate(id, cert!.code, now())).ok).toBe(true)
    }
    return id
  }
  const buy = (
    perf: SalePerformance,
    key: string,
    opts: { customerId?: string | null; bonus?: number; quantity?: number } = {},
  ) =>
    purchase.checkout({
      clientKey: key,
      performance: perf,
      selection: { kind: 'tickets', quantities: { std: opts.quantity ?? 2 } },
      email: 'buyer@example.com',
      customerId: opts.customerId ?? null,
      requestedBonusKopecks: opts.bonus ?? 0,
      method: 'card',
      siteOrigin: 'https://turdus.test',
    })
  const paymentOf = (orderId: string) =>
    [...bankState.payments.values()].find((p) => p.orderId === orderId)!
  const notify = (paymentId: string, eventId?: string) => {
    const n = fake.bank.notification(paymentId, eventId)!
    return purchase.handleNotification('fake', {
      headers: new Headers(n.headers),
      rawBody: n.rawBody,
    })
  }
  const count = async (query: ReturnType<typeof sql>) =>
    Number((await db.execute<{ n: string }>(query)).rows[0]!.n)

  beforeAll(async () => {
    const kit = createRequire(path.resolve('node_modules/@payloadcms/db-postgres/package.json'))(
      'drizzle-kit/api',
    ) as {
      generateDrizzleJson: (imports: Record<string, unknown>) => Promise<unknown>
      generateMigration: (prev: unknown, cur: unknown) => Promise<string[]>
    }
    const statements = await kit.generateMigration(
      await kit.generateDrizzleJson({}),
      await kit.generateDrizzleJson({ ...accountsTables, ...commerceTables, ...walletTables }),
    )
    await db.execute(sql.raw('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'))
    for (const statement of statements) await db.execute(sql.raw(statement))
  }, 60_000)

  afterAll(async () => {
    await db.$client.end()
  })

  it('pays once under parallel duplicate webhooks racing the reconciliation', async () => {
    const perf = performance('pg-dup', 10)
    const buyer = await customer(1000)
    const placed = await buy(perf, 'pg-key-dup-000000001', { customerId: buyer, bonus: 50_000 })
    if (!placed.ok) throw new Error(`checkout failed: ${placed.error}`)
    const again = await buy(perf, 'pg-key-dup-000000001', { customerId: buyer, bonus: 50_000 })
    expect(again).toMatchObject({ ok: true, replay: true, orderId: placed.orderId })
    const payment = paymentOf(placed.orderId)
    fake.bank.decide(payment.id, 'succeeded')
    clock = new Date(NOW.getTime() + 3 * MIN)
    await Promise.all([
      ...Array.from({ length: 6 }, (_, i) => notify(payment.id, `pg-evt-${i % 3}`)),
      purchase.reconcile(),
      purchase.orderStatus(placed.orderId, { customerId: buyer }),
    ])
    expect(
      await count(
        sql`SELECT count(*) AS n FROM commerce_tickets WHERE order_id = ${placed.orderId}`,
      ),
    ).toBe(2)
    expect(await count(sql`SELECT count(*) AS n FROM commerce_payment_events`)).toBe(3)
    expect(
      await count(
        sql`SELECT count(*) AS n FROM wallet_ledger WHERE kind = 'purchase' AND source_ref = ${placed.orderId}`,
      ),
    ).toBe(1)
    expect(await count(sql`SELECT count(*) AS n FROM wallet_ledger WHERE kind = 'spend'`)).toBe(1)
    const [row] = await store.inventory('pg-dup')
    expect(row).toMatchObject({ sold: 2, held: 0 })
    // 1000 ₽ − 500 ₽ списано + 3% от 2500 ₽ оплаченных деньгами билетов.
    expect(await wallet.balance(buyer, clock)).toBe(50_000 + 7_500)
    clock = NOW
  })

  it('one balance cannot pay two parallel orders', async () => {
    const perf = performance('pg-race', 20)
    const buyer = await customer(900)
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        buy(perf, `pg-key-race-00000000${i}`, { customerId: buyer, bonus: 90_000 }),
      ),
    )
    const spent = results.filter((r) => r.ok)
    // Победитель списал всё; остальные либо отменены (BONUS_CHANGED), либо успели прочитать
    // баланс 0 и оформились без бонусов. Двойного списания нет ни в одном исходе.
    expect(await wallet.balance(buyer, now())).toBe(0)
    expect(
      await count(
        sql`SELECT coalesce(sum(-amount_kopecks), 0) AS n FROM wallet_ledger WHERE kind = 'spend' AND customer_id = ${buyer}`,
      ),
    ).toBe(90_000)
    expect(spent.length).toBeGreaterThanOrEqual(1)
    const cancelled = results.filter((r) => !r.ok)
    expect(cancelled.every((r) => !r.ok && r.error === 'BONUS_CHANGED')).toBe(true)
    const [row] = await store.inventory('pg-race')
    expect(row!.held).toBe(spent.length * 2)
  })

  it('expiry returns bonuses once; a late payment re-spends them and sells from stock', async () => {
    const perf = performance('pg-late', 5)
    const buyer = await customer(1000)
    const placed = await buy(perf, 'pg-key-late-00000001', { customerId: buyer, bonus: 50_000 })
    if (!placed.ok) throw new Error(`checkout failed: ${placed.error}`)
    clock = new Date(NOW.getTime() + HOLD_TTL_MS + PENDING_PAYMENT_GRACE_MS + MIN)
    await Promise.all([purchase.reconcile(), purchase.reconcile()])
    expect((await orders.getOrder(placed.orderId))!.order.status).toBe('EXPIRED')
    expect(await wallet.balance(buyer, clock)).toBe(100_000)
    expect(
      await count(
        sql`SELECT count(*) AS n FROM wallet_ledger WHERE kind = 'release' AND customer_id = ${buyer}`,
      ),
    ).toBe(1)
    const payment = paymentOf(placed.orderId)
    fake.bank.decide(payment.id, 'succeeded')
    await Promise.all([notify(payment.id, 'pg-late-1'), notify(payment.id, 'pg-late-1')])
    expect((await orders.getOrder(placed.orderId))!.order.status).toBe('PAID')
    await purchase.reconcile()
    expect(await wallet.balance(buyer, clock)).toBe(50_000 + 7_500)
    const [row] = await store.inventory('pg-late')
    expect(row).toMatchObject({ sold: 2, held: 0 })
    clock = NOW
  })

  it('many buyers for the last tickets: paid tickets never exceed capacity', async () => {
    const perf = performance('pg-last', 3)
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        buy(perf, `pg-key-last-${String(i).padStart(8, '0')}`, { quantity: 1 }),
      ),
    )
    const placed = results.filter((r) => r.ok)
    expect(placed).toHaveLength(3)
    expect(results.filter((r) => !r.ok && r.error === 'UNAVAILABLE')).toHaveLength(9)
    await Promise.all(
      placed.map(async (r) => {
        if (!r.ok) return
        const id = paymentOf(r.orderId).id
        fake.bank.decide(id, 'succeeded')
        await Promise.all([notify(id), notify(id)])
      }),
    )
    expect(
      await count(sql`SELECT count(*) AS n FROM commerce_tickets WHERE performance_id = 'pg-last'`),
    ).toBe(3)
    const [row] = await store.inventory('pg-last')
    expect(row).toMatchObject({ capacity: 3, sold: 3, held: 0 })
  })
})
