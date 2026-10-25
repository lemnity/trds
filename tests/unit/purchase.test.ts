import { describe, expect, it } from 'vitest'

import { fetchOrderStatus, submitCheckout } from '../../src/components/checkout/checkout-api'
import { paymentsReconcileJob } from '../../src/jobs/tasks/payments-reconcile'
import { createLogger } from '../../src/lib/log'
import { createInventoryService } from '../../src/modules/inventory/inventory'
import { memoryCommerceStore } from '../../src/modules/inventory/memoryStore'
import { createPurchaseService, orderLines } from '../../src/modules/orders/purchase'
import {
  HOLD_TTL_MS,
  PENDING_PAYMENT_GRACE_MS,
  createOrderService,
} from '../../src/modules/orders/service'
import {
  PaymentConfigError,
  PaymentProviderError,
  callProvider,
  createFakeProvider,
  fakeBankState,
  selectPaymentProvider,
} from '../../src/modules/payments'
import { getSeatingPlan, seatsOf } from '../../src/modules/seating'
import type { SalePerformance } from '../../src/modules/shows'
import { createWalletService, memoryWalletStore } from '../../src/modules/wallet/service'

// Покупка end-to-end на памяти и учебном банке (T-043…T-045, T-061, T-062, rules.md §8).
const NOW = new Date('2026-11-20T10:00:00Z')
const MIN = 60_000
const ORIGIN = 'https://turdus.test'

const performance = (capacity = 5, id = 'perf-1'): SalePerformance =>
  ({
    id,
    startsAt: '2026-11-23T19:00:00+05:00',
    show: { slug: 'besy', title: 'Бесы' },
    venue: { id: 'loft', title: 'Лофт', address: '—', kind: 'loft' },
    ticketTypes: [{ id: 'std', title: 'Стандарт', priceKopecks: 150_000, capacity }],
    seating: null,
  }) as unknown as SalePerformance

const seated = (): SalePerformance => {
  const plan = getSeatingPlan('dom-aktera')!
  return {
    ...performance(0, 'perf-seats'),
    ticketTypes: [],
    seating: {
      plan,
      pricesKopecks: Object.fromEntries(plan.categories.map((c) => [c.id, 200_000])),
      pricesPlaceholder: false,
      unavailableSeatIds: [],
    },
  } as unknown as SalePerformance
}

const setup = ({ provider = true, capacity = 5 } = {}) => {
  let clock = NOW
  const now = () => clock
  const lines: string[] = []
  const log = createLogger({ level: 'debug', write: (l) => lines.push(l) })
  const store = memoryCommerceStore()
  const orders = createOrderService({ store, ticketSecret: 'test-ticket-secret' })
  const inventory = createInventoryService({ store })
  const walletStore = memoryWalletStore()
  const wallet = createWalletService({
    store: walletStore,
    secret: 'test-wallet-secret-0123456789',
  })
  const bankState = fakeBankState()
  const fake = createFakeProvider({ secret: 'fake-bank-secret', state: bankState, now })
  const purchase = createPurchaseService({
    orders,
    inventory,
    stock: store,
    wallet,
    provider: provider ? fake.provider : null,
    statusSecret: 'status-secret',
    log,
    now,
    call: { sleep: async () => {}, timeoutMs: 1_000 },
    allowPlaceholderPrices: true,
  })
  const perf = performance(capacity)

  const buy = (
    key = 'key-0000000000000001',
    opts: {
      customerId?: string | null
      bonus?: number
      quantity?: number
      perf?: SalePerformance
    } = {},
  ) =>
    purchase.checkout({
      clientKey: key,
      performance: opts.perf ?? perf,
      selection: { kind: 'tickets', quantities: { std: opts.quantity ?? 2 } },
      email: 'Guest@Example.com',
      customerId: opts.customerId ?? null,
      requestedBonusKopecks: opts.bonus ?? 0,
      method: 'card',
      siteOrigin: ORIGIN,
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
  /** Покупатель с бонусами: сертификат на `rubles` ₽. */
  const customerWith = async (customerId: string, rubles: number) => {
    const [cert] = await wallet.issueCertificates(
      { amountKopecks: rubles * 100, count: 1, issuedBy: 'тест' },
      now(),
    )
    const activated = await wallet.activateCertificate(customerId, cert!.code, now())
    expect(activated.ok).toBe(true)
    return customerId
  }
  const ledger = (kind: string) => walletStore.dump().ledger.filter((e) => e.kind === kind)
  const records = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>)
  return {
    store,
    orders,
    wallet,
    purchase,
    fake,
    bankState,
    perf,
    buy,
    paymentOf,
    notify,
    customerWith,
    ledger,
    records,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms)
    },
    now,
  }
}

const tokenOf = (url: string) => new URL(url).searchParams.get('token')

describe('checkout', () => {
  it('honestly refuses when no provider is configured and creates nothing', async () => {
    const t = setup({ provider: false })
    expect(await t.buy()).toEqual({ ok: false, error: 'PAYMENT_UNAVAILABLE' })
    expect(t.store.dump().orders).toHaveLength(0)
    expect(t.purchase.available).toBe(false)
  })

  it('places a held order and redirects to the bank; a retry with the key is the same order and payment', async () => {
    const t = setup()
    const first = await t.buy()
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.status).toBe('PENDING_PAYMENT')
    // 2 × 1500 ₽ + сбор 2 × 200 ₽ — посчитано сервером.
    expect(first.amountKopecks).toBe(340_000)
    expect(first.redirectUrl).toMatch(
      /^https:\/\/turdus\.test\/api\/payments\/fake\/bank\?payment=fake_/,
    )
    const again = await t.buy()
    expect(again).toMatchObject({ ok: true, replay: true, orderId: first.orderId })
    if (again.ok) expect(again.redirectUrl).toBe(first.redirectUrl)
    expect(t.store.dump().orders).toHaveLength(1)
    expect(t.bankState.payments.size).toBe(1)
    const [order] = t.store.dump().orders
    expect(order!.providerPaymentId).toBe(t.paymentOf(first.orderId).id)
    expect((await t.store.inventory('perf-1'))[0]).toMatchObject({ held: 2, sold: 0 })
  })

  it('scopes the client key to the customer: a guest cannot reach a customer order by key', async () => {
    const t = setup()
    const customer = await t.customerWith('c-1', 100)
    const own = await t.buy('key-shared-000000001', { customerId: customer })
    const guest = await t.buy('key-shared-000000001')
    expect(own.ok && guest.ok && own.orderId !== guest.orderId).toBe(true)
  })

  it('rejects invalid keys, wrong selections and sold-out stock', async () => {
    const t = setup({ capacity: 3 })
    expect(await t.buy('short')).toEqual({ ok: false, error: 'INVALID_KEY' })
    expect(await t.buy('key-0000000000000009', { quantity: 0 })).toEqual({
      ok: false,
      error: 'INVALID_SELECTION',
    })
    expect((await t.buy('key-0000000000000010', { quantity: 3 })).ok).toBe(true)
    const late = await t.buy('key-0000000000000011', { quantity: 1 })
    expect(late).toMatchObject({ ok: false, error: 'UNAVAILABLE' })
  })

  it('refuses placeholder prices unless explicitly allowed (only the fake bank)', async () => {
    const t = setup()
    const strict = createPurchaseService({
      orders: t.orders,
      inventory: createInventoryService({ store: t.store }),
      stock: t.store,
      wallet: t.wallet,
      provider: t.fake.provider,
      statusSecret: 's',
      log: createLogger({ write: () => {} }),
    })
    const result = await strict.checkout({
      clientKey: 'key-0000000000000020',
      performance: t.perf,
      selection: { kind: 'tickets', quantities: { std: 1 } },
      email: 'a@b.ru',
      customerId: null,
      requestedBonusKopecks: 0,
      method: 'card',
      siteOrigin: ORIGIN,
    })
    // Сервисный сбор в коде — заглушка (SERVICE_FEE.placeholder), с настоящим банком не продаём.
    expect(result).toEqual({ ok: false, error: 'PRICES_NOT_APPROVED' })
  })

  it('sells seats from the hall plan with the seat on each ticket', async () => {
    const t = setup()
    const perf = seated()
    const [a, b] = seatsOf(getSeatingPlan('dom-aktera')!)
    const result = await t.purchase.checkout({
      clientKey: 'key-seats-0000000001',
      performance: perf,
      selection: { kind: 'seats', seatIds: [a!.id, b!.id] },
      email: 'a@b.ru',
      customerId: null,
      requestedBonusKopecks: 0,
      method: 'sbp',
      siteOrigin: ORIGIN,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    t.fake.bank.decide(t.paymentOf(result.orderId).id, 'succeeded')
    await t.notify(t.paymentOf(result.orderId).id)
    const view = await t.orders.getOrder(result.orderId)
    expect(view!.order.status).toBe('PAID')
    expect(view!.tickets.map((x) => x.seatId).sort()).toEqual([a!.id, b!.id].sort())
  })

  it('orderLines takes prices only from performance data', () => {
    const lines = orderLines(performance(), { kind: 'tickets', quantities: { std: 2 } })
    expect(lines?.lines[0]).toMatchObject({ unitPriceKopecks: 150_000, quantity: 2 })
    expect(orderLines(performance(), { kind: 'tickets', quantities: { vip: 1 } })).toBeNull()
    expect(orderLines(performance(), { kind: 'seats', seatIds: ['x'] })).toBeNull()
  })
})

describe('payment confirmation', () => {
  it('duplicate and parallel webhooks issue tickets and accrue bonuses exactly once', async () => {
    const t = setup()
    const customer = await t.customerWith('c-dup', 100)
    const placed = await t.buy('key-dup-000000000001', { customerId: customer })
    if (!placed.ok) throw new Error('checkout failed')
    const payment = t.paymentOf(placed.orderId)
    t.fake.bank.decide(payment.id, 'succeeded')
    const results = await Promise.all([
      t.notify(payment.id, 'evt-1'),
      t.notify(payment.id, 'evt-1'),
      t.notify(payment.id, 'evt-2'),
      t.notify(payment.id, 'evt-3'),
      t.notify(payment.id, 'evt-1'),
    ])
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(results.filter((r) => r.body.duplicate === true)).toHaveLength(2)
    const dump = t.store.dump()
    expect(dump.tickets).toHaveLength(2)
    expect(dump.paymentEvents).toHaveLength(3)
    expect(dump.outbox.filter((o) => o.kind === 'order.paid')).toHaveLength(1)
    expect((await t.store.inventory('perf-1'))[0]).toMatchObject({ held: 0, sold: 2 })
    // 3% от 3000 ₽ билетов (сбор не входит) — один раз.
    expect(t.ledger('purchase')).toHaveLength(1)
    expect(t.ledger('purchase')[0]!.amountKopecks).toBe(9_000)
    await t.purchase.reconcile()
    await t.purchase.afterPaid(placed.orderId)
    expect(t.ledger('purchase')).toHaveLength(1)
  })

  it('webhook before the customer returns: the result page shows paid from the server', async () => {
    const t = setup()
    const placed = await t.buy()
    if (!placed.ok) throw new Error('checkout failed')
    const payment = t.paymentOf(placed.orderId)
    t.fake.bank.decide(payment.id, 'succeeded')
    await t.notify(payment.id)
    // Покупатель ещё в банке; ссылка возврата — с подписью заказа.
    const token = tokenOf(payment.returnUrl)
    const view = await t.purchase.orderStatus(placed.orderId, { token })
    expect(view).toMatchObject({ status: 'paid', ticketCount: 2, amountKopecks: 340_000 })
    // Без подписи и не владелец — заказ «не найден».
    expect(await t.purchase.orderStatus(placed.orderId, { token: 'forged' })).toBeNull()
    expect(await t.purchase.orderStatus(placed.orderId, { customerId: 'someone' })).toBeNull()
  })

  it('a forged, malformed or foreign notification changes nothing', async () => {
    const t = setup()
    const placed = await t.buy()
    if (!placed.ok) throw new Error('checkout failed')
    const payment = t.paymentOf(placed.orderId)
    t.fake.bank.decide(payment.id, 'succeeded')
    const body = JSON.stringify({ eventId: 'e', type: 'payment.succeeded', paymentId: payment.id })
    const forged = await t.purchase.handleNotification('fake', {
      headers: new Headers({ 'x-fake-bank-signature': 'a'.repeat(64) }),
      rawBody: body,
    })
    expect(forged.status).toBe(401)
    const garbage = '{not json'
    const malformed = await t.purchase.handleNotification('fake', {
      headers: new Headers({ 'x-fake-bank-signature': t.fake.bank.sign(garbage) }),
      rawBody: garbage,
    })
    expect(malformed.status).toBe(400)
    expect(
      (await t.purchase.handleNotification('other-bank', { headers: new Headers(), rawBody: body }))
        .status,
    ).toBe(404)
    expect(t.store.dump().orders[0]!.status).toBe('PENDING_PAYMENT')
    expect(t.store.dump().paymentEvents).toHaveLength(0)
  })

  it('confirms by the bank answer, not by the notification body: amount mismatch → NEEDS_REVIEW', async () => {
    const t = setup()
    const placed = await t.buy()
    if (!placed.ok) throw new Error('checkout failed')
    const payment = t.bankState.payments.get(t.paymentOf(placed.orderId).id)!
    payment.status = 'succeeded'
    payment.amountKopecks = 100 // банк списал не ту сумму
    const result = await t.notify(payment.id)
    expect(result.body.outcome).toBe('review')
    const view = await t.orders.getOrder(placed.orderId)
    expect(view!.order).toMatchObject({ status: 'NEEDS_REVIEW', reviewReason: 'AMOUNT_MISMATCH' })
    expect(view!.tickets).toHaveLength(0)
    expect((await t.store.inventory('perf-1'))[0]).toMatchObject({ held: 0, sold: 0 })
    expect(t.records().some((r) => r.alert === 'ALERT_PAYMENT_REVIEW')).toBe(true)
    expect(
      (await t.purchase.orderStatus(placed.orderId, { token: tokenOf(payment.returnUrl) }))!.status,
    ).toBe('review')
  })

  it('currency mismatch → NEEDS_REVIEW', async () => {
    const t = setup()
    const placed = await t.buy()
    if (!placed.ok) throw new Error('checkout failed')
    const payment = t.bankState.payments.get(t.paymentOf(placed.orderId).id)!
    payment.status = 'succeeded'
    payment.currency = 'USD'
    await t.notify(payment.id)
    expect((await t.orders.getOrder(placed.orderId))!.order.reviewReason).toBe('CURRENCY_MISMATCH')
  })

  it('a declined payment cancels the order, frees the hold and returns spent bonuses', async () => {
    const t = setup()
    const customer = await t.customerWith('c-decline', 1000)
    const placed = await t.buy('key-decline-00000001', { customerId: customer, bonus: 50_000 })
    if (!placed.ok) throw new Error('checkout failed')
    expect(await t.wallet.balance(customer, t.now())).toBe(50_000)
    const payment = t.paymentOf(placed.orderId)
    t.fake.bank.decide(payment.id, 'canceled')
    await t.notify(payment.id)
    await t.notify(payment.id) // повтор уведомления
    expect((await t.orders.getOrder(placed.orderId))!.order.status).toBe('CANCELLED')
    expect((await t.store.inventory('perf-1'))[0]).toMatchObject({ held: 0, sold: 0 })
    expect(await t.wallet.balance(customer, t.now())).toBe(100_000)
    expect(t.ledger('release')).toHaveLength(1)
    expect((await t.purchase.orderStatus(placed.orderId, { customerId: customer }))!.status).toBe(
      'failed',
    )
  })
})

describe('bonuses in checkout', () => {
  it('caps the spend at 30% of tickets and the balance; the client number is only a wish', async () => {
    const t = setup()
    const customer = await t.customerWith('c-cap', 5000)
    const placed = await t.buy('key-cap-000000000001', { customerId: customer, bonus: 10_000_000 })
    if (!placed.ok) throw new Error('checkout failed')
    const order = (await t.orders.getOrder(placed.orderId))!.order
    // 30% от 3000 ₽ = 900 ₽; к оплате 3000 − 900 + 400 сбора.
    expect(order.bonusKopecks).toBe(90_000)
    expect(order.cashKopecks).toBe(250_000)
    expect(t.paymentOf(placed.orderId).amountKopecks).toBe(250_000)
    expect(await t.wallet.balance(customer, t.now())).toBe(410_000)
    // Повтор того же оформления не списывает второй раз.
    await t.buy('key-cap-000000000001', { customerId: customer, bonus: 10_000_000 })
    expect(t.ledger('spend')).toHaveLength(1)
  })

  it('guests cannot spend bonuses', async () => {
    const t = setup()
    const placed = await t.buy('key-guest-0000000001', { bonus: 50_000 })
    if (!placed.ok) throw new Error('checkout failed')
    expect((await t.orders.getOrder(placed.orderId))!.order.bonusKopecks).toBe(0)
  })

  it('one balance cannot pay two parallel orders: the loser is cancelled and its hold freed', async () => {
    const t = setup({ capacity: 10 })
    const customer = await t.customerWith('c-race', 900)
    const [a, b] = await Promise.all([
      t.buy('key-race-00000000001', { customerId: customer, bonus: 90_000 }),
      t.buy('key-race-00000000002', { customerId: customer, bonus: 90_000 }),
    ])
    const results = [a, b]
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok && r.error === 'BONUS_CHANGED')).toHaveLength(1)
    expect(await t.wallet.balance(customer, t.now())).toBe(0)
    expect((await t.store.inventory('perf-1'))[0]).toMatchObject({ held: 2 })
    expect(t.bankState.payments.size).toBe(1)
  })

  it('counts the first paid purchase of an invited friend exactly once', async () => {
    const t = setup({ capacity: 20 })
    const code = await t.wallet.ensureReferralCode('referrer', t.now())
    for (const friend of ['f1', 'f2', 'f3']) {
      expect(await t.wallet.attachReferral(friend, code, t.now())).toEqual({ ok: true })
      const placed = await t.buy(`key-friend-${friend}-0000001`, {
        customerId: friend,
        quantity: 1,
      })
      if (!placed.ok) throw new Error('checkout failed')
      const payment = t.paymentOf(placed.orderId)
      t.fake.bank.decide(payment.id, 'succeeded')
      await Promise.all([t.notify(payment.id), t.notify(payment.id)])
    }
    // Вторая покупка друга не засчитывается повторно.
    const again = await t.buy('key-friend-f1-0000002', { customerId: 'f1', quantity: 1 })
    if (!again.ok) throw new Error('checkout failed')
    t.fake.bank.decide(t.paymentOf(again.orderId).id, 'succeeded')
    await t.notify(t.paymentOf(again.orderId).id)
    await t.purchase.reconcile()
    expect(t.ledger('referral')).toHaveLength(1)
    expect(t.ledger('referral')[0]).toMatchObject({
      customerId: 'referrer',
      amountKopecks: 100_000,
    })
  })
})

describe('provider failures', () => {
  it('timeout after the bank created the payment: retry with the key reuses that payment', async () => {
    const t = setup()
    t.fake.bank.faults.create = { kind: 'timeout', afterCreate: true }
    // Все попытки вызова в первом запросе — один «потерянный» ответ, затем успешные повторы.
    const first = await t.buy('key-timeout-00000001')
    expect(first.ok).toBe(true)
    expect(t.bankState.payments.size).toBe(1)
    t.fake.bank.faults.create = { kind: 'timeout' }
    const again = await t.buy('key-timeout-00000001')
    expect(again.ok).toBe(true)
    expect(t.bankState.payments.size).toBe(1)
  })

  it('bank down for every attempt → PAYMENT_RETRY, order kept for a retry with the same key', async () => {
    const t = setup()
    const flaky = t.fake.provider
    let calls = 0
    const original = flaky.createPayment.bind(flaky)
    flaky.createPayment = async (input, signal) => {
      calls++
      if (calls <= 3) throw new PaymentProviderError('unavailable', 'down')
      return original(input, signal)
    }
    expect(await t.buy('key-down-00000000001')).toEqual({ ok: false, error: 'PAYMENT_RETRY' })
    expect(t.store.dump().orders[0]!.status).toBe('PENDING_PAYMENT')
    const retry = await t.buy('key-down-00000000001')
    expect(retry).toMatchObject({ ok: true, replay: true })
    expect(t.bankState.payments.size).toBe(1)
  })

  it('a definitive refusal cancels the order and returns the bonuses', async () => {
    const t = setup()
    const customer = await t.customerWith('c-rej', 1000)
    t.fake.bank.faults.create = { kind: 'rejected' }
    const result = await t.buy('key-reject-000000001', { customerId: customer, bonus: 50_000 })
    expect(result).toEqual({ ok: false, error: 'PAYMENT_FAILED' })
    expect(t.store.dump().orders[0]!.status).toBe('CANCELLED')
    expect(await t.wallet.balance(customer, t.now())).toBe(100_000)
    expect(await t.buy('key-reject-000000001', { customerId: customer, bonus: 50_000 })).toEqual({
      ok: false,
      error: 'ORDER_CLOSED',
    })
  })
})

describe('reconciliation', () => {
  it('recovers a missed webhook from the bank', async () => {
    const t = setup()
    const customer = await t.customerWith('c-miss', 100)
    const placed = await t.buy('key-missed-000000001', { customerId: customer })
    if (!placed.ok) throw new Error('checkout failed')
    t.fake.bank.decide(t.paymentOf(placed.orderId).id, 'succeeded') // уведомление не пришло
    await t.purchase.reconcile() // слишком рано — не трогаем
    expect((await t.orders.getOrder(placed.orderId))!.order.status).toBe('PENDING_PAYMENT')
    t.advance(3 * MIN)
    const stats = await t.purchase.reconcile()
    expect(stats.synced).toBe(1)
    expect((await t.orders.getOrder(placed.orderId))!.order.status).toBe('PAID')
    expect(t.ledger('purchase')).toHaveLength(1)
  })

  it('the result page itself syncs a pending order with the bank (throttled)', async () => {
    const t = setup()
    const placed = await t.buy()
    if (!placed.ok) throw new Error('checkout failed')
    const payment = t.paymentOf(placed.orderId)
    const token = tokenOf(payment.returnUrl)
    expect((await t.purchase.orderStatus(placed.orderId, { token }))!.status).toBe('pending')
    t.fake.bank.decide(payment.id, 'succeeded')
    // Сразу — без нового запроса к банку (не чаще раза в 5 с).
    expect((await t.purchase.orderStatus(placed.orderId, { token }))!.status).toBe('pending')
    t.advance(6_000)
    expect((await t.purchase.orderStatus(placed.orderId, { token }))!.status).toBe('paid')
  })

  it('expires an unpaid hold, returns bonuses once, and re-spends them for a late payment', async () => {
    const t = setup()
    const customer = await t.customerWith('c-late', 1000)
    const placed = await t.buy('key-late-00000000001', { customerId: customer, bonus: 50_000 })
    if (!placed.ok) throw new Error('checkout failed')
    expect(await t.wallet.balance(customer, t.now())).toBe(50_000)
    // Бронь кончилась, банк говорит «в процессе» — ждём grace.
    t.advance(HOLD_TTL_MS + MIN)
    await t.purchase.reconcile()
    expect((await t.orders.getOrder(placed.orderId))!.order.status).toBe('PENDING_PAYMENT')
    t.advance(PENDING_PAYMENT_GRACE_MS)
    const stats = await t.purchase.reconcile()
    expect(stats.expired).toBe(1)
    expect((await t.orders.getOrder(placed.orderId))!.order.status).toBe('EXPIRED')
    expect(await t.wallet.balance(customer, t.now())).toBe(100_000)
    await t.purchase.reconcile()
    expect(t.ledger('release')).toHaveLength(1)
    // Банк всё же провёл платёж: остаток есть — PAID, бонусы списываются заново.
    const payment = t.paymentOf(placed.orderId)
    t.fake.bank.decide(payment.id, 'succeeded')
    expect((await t.notify(payment.id)).body.outcome).toBe('paid')
    const view = await t.orders.getOrder(placed.orderId)
    expect(view!.order.status).toBe('PAID')
    expect(view!.tickets).toHaveLength(2)
    expect(await t.wallet.balance(customer, t.now())).toBe(50_000 + 7_500)
    await t.purchase.reconcile()
    expect(t.ledger('spend')).toHaveLength(2)
    expect(t.ledger('purchase')).toHaveLength(1)
  })

  it('late payment without stock goes to review and never oversells', async () => {
    const t = setup({ capacity: 2 })
    const first = await t.buy('key-nostock-00000001')
    if (!first.ok) throw new Error('checkout failed')
    // Банк молчит («в процессе»), бронь истекает после grace.
    t.advance(HOLD_TTL_MS + PENDING_PAYMENT_GRACE_MS + MIN)
    await t.purchase.reconcile()
    const second = await t.buy('key-nostock-00000002')
    if (!second.ok) throw new Error('checkout failed')
    t.fake.bank.decide(t.paymentOf(second.orderId).id, 'succeeded')
    await t.notify(t.paymentOf(second.orderId).id)
    const late = t.bankState.payments.get(t.paymentOf(first.orderId).id)!
    late.status = 'succeeded'
    expect((await t.notify(late.id)).body.outcome).toBe('review')
    expect((await t.orders.getOrder(first.orderId))!.order.reviewReason).toBe(
      'LATE_PAYMENT_NO_STOCK',
    )
    expect((await t.store.inventory('perf-1'))[0]).toMatchObject({ sold: 2, held: 0 })
    expect(t.store.dump().tickets).toHaveLength(2)
  })

  it('a provider outage during reconciliation does not expire a hold before the grace period', async () => {
    const t = setup()
    const placed = await t.buy()
    if (!placed.ok) throw new Error('checkout failed')
    t.advance(HOLD_TTL_MS + MIN)
    t.fake.bank.faults.get = { kind: 'unavailable' }
    await t.purchase.reconcile()
    expect((await t.orders.getOrder(placed.orderId))!.order.status).toBe('PENDING_PAYMENT')
  })

  it('the worker job runs reconciliation and reports activity', async () => {
    const t = setup()
    const placed = await t.buy()
    if (!placed.ok) throw new Error('checkout failed')
    t.fake.bank.decide(t.paymentOf(placed.orderId).id, 'succeeded')
    t.advance(3 * MIN)
    const lines: string[] = []
    const job = paymentsReconcileJob({
      purchase: async () => t.purchase,
      log: createLogger({ write: (l) => lines.push(l) }),
    })
    expect(job.name).toBe('payments.reconcile')
    await job.run()
    expect(lines.some((l) => l.includes('payments.reconciled'))).toBe(true)
  })
})

describe('payment provider layer', () => {
  it('selects the provider by PAYMENT_PROVIDER and refuses the fake bank in production', () => {
    expect(selectPaymentProvider({})).toBeNull()
    expect(selectPaymentProvider({ PAYMENT_PROVIDER: ' ' })).toBeNull()
    expect(selectPaymentProvider({ PAYMENT_PROVIDER: 'fake', NODE_ENV: 'test' })?.provider.id).toBe(
      'fake',
    )
    expect(() =>
      selectPaymentProvider({ PAYMENT_PROVIDER: 'fake', NODE_ENV: 'production' }),
    ).toThrow(PaymentConfigError)
    expect(() => selectPaymentProvider({ PAYMENT_PROVIDER: 'mybank' })).toThrow(PaymentConfigError)
  })

  it('the fake provider itself refuses to load in production', () => {
    const previous = process.env.NODE_ENV
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    try {
      expect(() => createFakeProvider({ secret: 'x' })).toThrow(/production/)
    } finally {
      ;(process.env as Record<string, string | undefined>).NODE_ENV = previous
    }
  })

  it('fake bank: idempotent create, key reuse with other data is rejected, refunds are capped', async () => {
    const { provider, bank } = createFakeProvider({ secret: 'x' })
    const input = {
      idempotencyKey: 'payment:o1',
      orderId: 'o1',
      orderNumber: 'TRD-1',
      amountKopecks: 1000,
      currency: 'RUB' as const,
      description: 'd',
      returnUrl: 'https://x.test/r',
    }
    const a = await provider.createPayment(input)
    expect((await provider.createPayment(input)).providerPaymentId).toBe(a.providerPaymentId)
    await expect(provider.createPayment({ ...input, amountKopecks: 1 })).rejects.toMatchObject({
      kind: 'rejected',
    })
    bank.decide(a.providerPaymentId, 'succeeded')
    bank.decide(a.providerPaymentId, 'canceled') // решение окончательное
    expect((await provider.getPayment(a.providerPaymentId))!.status).toBe('succeeded')
    const refund = {
      idempotencyKey: 'r1',
      providerPaymentId: a.providerPaymentId,
      amountKopecks: 600,
      currency: 'RUB' as const,
    }
    const r1 = await provider.refund(refund)
    expect((await provider.refund(refund)).providerRefundId).toBe(r1.providerRefundId)
    await expect(provider.refund({ ...refund, idempotencyKey: 'r2' })).rejects.toMatchObject({
      kind: 'rejected',
    })
  })

  it('callProvider retries only retryable failures and times out hung calls', async () => {
    const sleep = async () => {}
    let n = 0
    expect(
      await callProvider(
        async () => {
          if (++n < 3) throw new PaymentProviderError('unavailable', 'x')
          return 'ok'
        },
        { sleep },
      ),
    ).toBe('ok')
    let rejected = 0
    await expect(
      callProvider(
        async () => {
          rejected++
          throw new PaymentProviderError('rejected', 'no')
        },
        { sleep },
      ),
    ).rejects.toMatchObject({ kind: 'rejected' })
    expect(rejected).toBe(1)
    await expect(
      callProvider(() => new Promise(() => {}), { sleep, timeoutMs: 10, attempts: 2 }),
    ).rejects.toMatchObject({ kind: 'timeout' })
  })
})

describe('wallet compensation', () => {
  const wallet = () => {
    const store = memoryWalletStore()
    return {
      store,
      wallet: createWalletService({ store, secret: 'wallet-secret-0123456789abcdef' }),
    }
  }

  it('releases a spend once, keeping the expiry of the original lots', async () => {
    const { store, wallet: w } = wallet()
    await w.accrue('c', 10_000_000, 'order-a', NOW) // 3% = 3000 ₽, сгорит через год
    const lot = store.dump().ledger[0]!
    expect(await w.spendStatus('order-b')).toBe('none')
    expect(await w.releaseSpend('order-b', NOW)).toEqual({ releasedKopecks: 0, duplicate: false })
    await w.spend('c', 100_000, 'order-b', NOW)
    expect(await w.spendStatus('order-b')).toBe('spent')
    const later = new Date(NOW.getTime() + 60 * MIN)
    const [r1, r2] = await Promise.all([
      w.releaseSpend('order-b', later),
      w.releaseSpend('order-b', later),
    ])
    expect([r1.releasedKopecks, r2.releasedKopecks].sort()).toEqual([0, 100_000])
    expect(await w.spendStatus('order-b')).toBe('released')
    const release = store.dump().ledger.filter((e) => e.kind === 'release')
    expect(release).toHaveLength(1)
    expect(release[0]).toMatchObject({ relatedEntryId: lot.id, expiresAt: lot.expiresAt })
    expect(await w.balance('c', later)).toBe(300_000)
  })
})

describe('checkout client', () => {
  const reply = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
  const request = {
    idempotencyKey: 'key-client-000000001',
    performanceId: 'p',
    selection: { kind: 'tickets' as const, quantities: { std: 1 } },
    contact: {
      email: 'a@b.ru',
      payment: 'card' as const,
      consent: true as const,
      rulesAccepted: true as const,
    },
    bonusKopecks: 0,
  }

  it('maps server answers to what the form shows', async () => {
    expect(
      await submitCheckout(request, reply(200, { ok: true, redirectUrl: 'https://bank.test/pay' })),
    ).toEqual({
      kind: 'redirect',
      url: 'https://bank.test/pay',
    })
    expect(
      await submitCheckout(request, reply(200, { ok: true, redirectUrl: 'javascript:alert(1)' })),
    ).toMatchObject({
      kind: 'retry',
    })
    expect(await submitCheckout(request, reply(503, { code: 'payment_unavailable' }))).toEqual({
      kind: 'unavailable',
    })
    expect(await submitCheckout(request, reply(503, { code: 'payment_retry' }))).toMatchObject({
      kind: 'retry',
    })
    expect(await submitCheckout(request, reply(409, { code: 'order_closed' }))).toMatchObject({
      kind: 'error',
      code: 'order_closed',
    })
    const offline = (async () => {
      throw new TypeError('network')
    }) as unknown as typeof fetch
    expect(await submitCheckout(request, offline)).toMatchObject({ kind: 'retry' })
  })

  it('reads the order status only from the server answer', async () => {
    expect(await fetchOrderStatus('o', 't', reply(404, {}))).toBeNull()
    expect(await fetchOrderStatus('o', 't', reply(500, {}))).toBe('error')
    expect(
      await fetchOrderStatus('o', 't', reply(200, { status: 'hacked', orderNumber: 'x' })),
    ).toBe('error')
    expect(
      await fetchOrderStatus('o', 't', reply(200, { status: 'paid', orderNumber: 'TRD-1' })),
    ).toMatchObject({ status: 'paid' })
  })
})
