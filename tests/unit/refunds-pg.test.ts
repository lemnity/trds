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
import { createOrderService } from '../../src/modules/orders/service'
import { createFakeProvider, fakeBankState } from '../../src/modules/payments'
import { DEFAULT_REFUND_POLICY } from '../../src/modules/refunds/policy'
import { createRefundService } from '../../src/modules/refunds/service'
import type { SalePerformance } from '../../src/modules/shows'
import { pgWalletStore } from '../../src/modules/wallet/pgStore'
import { createWalletService } from '../../src/modules/wallet/service'

/**
 * Возвраты на настоящем PostgreSQL (T-052, T-053, T-064): двойной клик и параллельные запросы
 * (частичный уникальный индекс живого возврата билета), частичный возврат с долями `allocate`,
 * бонусы и долг, таймаут банка и сверка. Только с REFUNDS_PG_URL — ОДНОРАЗОВАЯ база: схема
 * public пересоздаётся. Например:
 *   docker run --rm -d --name refunds-pg-test -p 127.0.0.1:55439:5432 \
 *     -e POSTGRES_PASSWORD=x postgres:16.15-alpine
 *   REFUNDS_PG_URL=postgres://postgres:x@127.0.0.1:55439/postgres pnpm vitest run refunds-pg
 */
const url = process.env.REFUNDS_PG_URL

const NOW = new Date('2026-11-20T10:00:00Z')
const MIN = 60_000
const STAFF = { kind: 'staff' as const, staffId: '1', role: 'admin' }

describe.skipIf(!url)('refunds on PostgreSQL', () => {
  const db = drizzle({ connection: { connectionString: url!, max: 30 } })
  const store = pgCommerceStore(db as unknown as Parameters<typeof pgCommerceStore>[0])
  const walletStore = pgWalletStore(db as unknown as Parameters<typeof pgWalletStore>[0])
  let clock = NOW
  const now = () => clock
  const log = createLogger({ write: () => {} })
  const wallet = createWalletService({ store: walletStore, secret: 'pg-wallet-secret-0123456789' })
  const bankState = fakeBankState()
  const fake = createFakeProvider({ secret: 'pg-fake-bank', state: bankState, now })
  const call = { sleep: async () => {} }
  const purchase = createPurchaseService({
    orders: createOrderService({ store, ticketSecret: 'pg-ticket-secret' }),
    inventory: createInventoryService({ store }),
    stock: store,
    wallet,
    provider: fake.provider,
    statusSecret: 'pg-status',
    log,
    now,
    call,
    allowPlaceholderPrices: true,
  })
  const refunds = createRefundService({ store, provider: fake.provider, wallet, log, now, call })

  let seq = 0
  const key = () => `pg-refund-key-${String(++seq).padStart(8, '0')}`
  const performance = (id: string, price = 150_000) =>
    ({
      id,
      startsAt: '2026-11-25T19:00:00+05:00',
      show: { slug: 'besy', title: 'Бесы' },
      venue: { id: 'loft', title: 'Лофт', address: 'ул. Ленина, 1', kind: 'loft' },
      ticketTypes: [{ id: 'std', title: 'Стандарт', priceKopecks: price, capacity: 20 }],
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

  const buyPaid = async (
    perf: SalePerformance,
    customerId: string,
    quantity: number,
    bonus = 0,
  ) => {
    const placed = await purchase.checkout({
      clientKey: key(),
      performance: perf,
      selection: { kind: 'tickets', quantities: { std: quantity } },
      email: 'buyer@example.com',
      customerId,
      requestedBonusKopecks: bonus,
      method: 'card',
      siteOrigin: 'https://turdus.test',
    })
    if (!placed.ok) throw new Error(`checkout failed: ${placed.error}`)
    const payment = [...bankState.payments.values()].find((p) => p.orderId === placed.orderId)!
    fake.bank.decide(payment.id, 'succeeded')
    const n = fake.bank.notification(payment.id)!
    await purchase.handleNotification('fake', {
      headers: new Headers(n.headers),
      rawBody: n.rawBody,
    })
    const tickets = (await store.tickets(placed.orderId)).sort((a, b) =>
      a.number < b.number ? -1 : 1,
    )
    return { ...placed, payment, tickets }
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
    await refunds.updatePolicy({ ...DEFAULT_REFUND_POLICY, customerRefundsEnabled: true }, STAFF)
  }, 60_000)

  afterAll(async () => {
    await db.$client.end()
  })

  it('double click and parallel requests for one ticket: one refund row, one bank refund', async () => {
    const buyer = await customer()
    const order = await buyPaid(performance('pg-par'), buyer, 2)
    fake.bank.refunds.mode = 'pending'
    const k = key()
    const same = await Promise.all(
      Array.from({ length: 4 }, () =>
        refunds.requestCustomerRefund({
          customerId: buyer,
          ticketNumbers: [order.tickets[0]!.number],
          clientKey: k,
        }),
      ),
    )
    const other = await Promise.all(
      Array.from({ length: 6 }, () =>
        refunds.requestCustomerRefund({
          customerId: buyer,
          ticketNumbers: [order.tickets[0]!.number],
          clientKey: key(),
        }),
      ),
    )
    fake.bank.refunds.mode = 'succeeded'
    expect(same.every((r) => r.ok)).toBe(true)
    expect(new Set(same.map((r) => (r.ok ? r.refund.id : '')))).toHaveProperty('size', 1)
    expect(other.every((r) => !r.ok && r.error === 'IN_PROGRESS')).toBe(true)
    expect(
      await count(
        sql`SELECT count(*) AS n FROM commerce_refunds WHERE order_id = ${order.orderId}`,
      ),
    ).toBe(1)
    expect(
      [...bankState.refunds.values()].filter((r) => r.paymentId === order.payment.id),
    ).toHaveLength(1)
    expect(bankState.payments.get(order.payment.id)!.refundedKopecks).toBe(150_000)
  })

  it('parallel refunds of all tickets: order REFUNDED, stock returned, money equals the payment', async () => {
    const buyer = await customer()
    const perf = performance('pg-all')
    const order = await buyPaid(perf, buyer, 3)
    const results = await Promise.all(
      order.tickets.map((t) =>
        refunds.requestCustomerRefund({
          customerId: buyer,
          ticketNumbers: [t.number],
          clientKey: key(),
        }),
      ),
    )
    expect(results.every((r) => r.ok && r.refund.status === 'SUCCEEDED')).toBe(true)
    expect((await store.order(order.orderId))!.status).toBe('REFUNDED')
    expect((await store.inventory('pg-all'))[0]).toMatchObject({ sold: 0, held: 0 })
    // Сбор не возвращается по умолчанию: вернули ровно денежную часть билетов.
    expect(bankState.payments.get(order.payment.id)!.refundedKopecks).toBe(3 * 150_000)
  })

  it('partial refunds with bonus shares (allocate) sum exactly; bonuses come back, accrual reversed', async () => {
    const buyer = await customer(1000)
    // 3 × 1000,01 ₽, бонусами 900 ₽ → доли 300 ₽ на билет; копейки цены — нечётное деление 3%.
    const order = await buyPaid(performance('pg-round', 100_001), buyer, 3, 90_000)
    const bonusShares = order.tickets.map((t) => t.bonusKopecks)
    expect(bonusShares.reduce((n, b) => n + b, 0)).toBe(90_000)
    const balanceAfterBuy = await wallet.balance(buyer, now())
    const accrued = balanceAfterBuy - (100_000 - 90_000)

    let cash = 0
    let reversed = 0
    for (const t of order.tickets) {
      const r = await refunds.requestStaffRefund({
        staff: STAFF,
        orderNumber: order.orderNumber,
        ticketNumbers: [t.number],
        reason: 'Тест округления',
        includeFee: true,
        clientKey: key(),
      })
      if (!r.ok) throw new Error(r.error)
      cash += r.refund.cashKopecks
      reversed += (await refunds.refund(r.refund.id))!.bonusReversalKopecks
    }
    const o = (await store.order(order.orderId))!
    expect(cash).toBe(o.cashKopecks)
    expect(reversed).toBe(accrued)
    expect(o.status).toBe('REFUNDED')
    expect(await wallet.balance(buyer, now())).toBe(100_000)
    expect(await wallet.debt(buyer)).toBe(0)
  })

  it('debt rule: reversal of already spent accrual never makes the balance negative', async () => {
    const buyer = await customer()
    const a = await buyPaid(performance('pg-debt'), buyer, 2) // начислено 90 ₽
    await buyPaid(performance('pg-debt'), buyer, 1, 9_000) // потрачено 90 ₽, начислено 42 ₽
    const r = await refunds.requestStaffRefund({
      staff: STAFF,
      orderNumber: a.orderNumber,
      ticketNumbers: [],
      reason: 'Отмена',
      includeFee: false,
      clientKey: key(),
    })
    expect(r).toMatchObject({ ok: true, refund: { status: 'SUCCEEDED' } })
    expect(await wallet.balance(buyer, now())).toBe(0)
    expect(await wallet.debt(buyer)).toBe(4_800)
    // Параллельные начисления гасят долг ровно один раз.
    await Promise.all([
      buyPaid(performance('pg-debt'), buyer, 1),
      buyPaid(performance('pg-debt'), buyer, 1),
    ])
    expect(await wallet.debt(buyer)).toBe(0)
    expect(await wallet.balance(buyer, now())).toBe(2 * 4_500 - 4_800)
    expect(
      await count(
        sql`SELECT count(*) AS n FROM wallet_ledger WHERE customer_id = ${buyer} AND lot_remaining_kopecks < 0`,
      ),
    ).toBe(0)
  })

  it('bank timeout with a lost response: reconcile repeats with the same key, money once', async () => {
    const buyer = await customer()
    const order = await buyPaid(performance('pg-timeout'), buyer, 1)
    const original = fake.provider.refund.bind(fake.provider)
    let lose = 3
    fake.provider.refund = async (input, signal) => {
      const result = await original(input, signal)
      if (lose-- > 0) throw new Error('socket hang up')
      return result
    }
    const r = await refunds.requestCustomerRefund({
      customerId: buyer,
      ticketNumbers: [order.tickets[0]!.number],
      clientKey: key(),
    })
    expect(r).toMatchObject({ ok: true, refund: { status: 'REQUESTED' } })
    clock = new Date(clock.getTime() + 2 * MIN)
    // Две сверки параллельно (два worker): банк спрашивают с тем же ключом, итог один.
    await Promise.all([refunds.reconcile(), refunds.reconcile()])
    fake.provider.refund = original
    expect((await refunds.refund(r.ok ? r.refund.id : ''))!.status).toBe('SUCCEEDED')
    expect(bankState.payments.get(order.payment.id)!.refundedKopecks).toBe(150_000)
    expect(
      await count(
        sql`SELECT count(*) AS n FROM commerce_outbox WHERE kind = 'refund.succeeded' AND aggregate_id = ${r.ok ? r.refund.id : ''}`,
      ),
    ).toBe(1)
    expect(
      await count(
        sql`SELECT count(*) AS n FROM commerce_audit_log WHERE entity = 'refund' AND entity_id = ${r.ok ? r.refund.id : ''} AND action = 'refund.succeeded'`,
      ),
    ).toBe(1)
  })

  it('order item snapshot is stored for tickets, emails and the worker', async () => {
    const buyer = await customer()
    const order = await buyPaid(performance('pg-snap'), buyer, 1)
    const [item] = await store.items(order.orderId)
    expect(item).toMatchObject({
      showTitleSnapshot: 'Бесы',
      venueTitleSnapshot: 'Лофт',
      venueAddressSnapshot: 'ул. Ленина, 1',
      startsAtSnapshot: new Date('2026-11-25T14:00:00Z'),
    })
  })
})
