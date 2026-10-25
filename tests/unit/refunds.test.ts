import { describe, expect, it } from 'vitest'

import { refundsReconcileJob } from '../../src/jobs/tasks/refunds-reconcile'
import { createLogger } from '../../src/lib/log'
import { allocate } from '../../src/modules/checkout'
import type { EmailMessage } from '../../src/modules/email'
import { createInventoryService } from '../../src/modules/inventory/inventory'
import { memoryCommerceStore } from '../../src/modules/inventory/memoryStore'
import { createPurchaseService } from '../../src/modules/orders/purchase'
import { createOrderService } from '../../src/modules/orders/service'
import { createFakeProvider, fakeBankState } from '../../src/modules/payments'
import { refundAmounts, reversalShare } from '../../src/modules/refunds/amounts'
import {
  DEFAULT_REFUND_POLICY,
  REFUND_POLICY_KEY,
  customerRefundBlock,
  parseRefundPolicy,
  type RefundPolicy,
} from '../../src/modules/refunds/policy'
import { MAX_UNKNOWN_ATTEMPTS, createRefundService } from '../../src/modules/refunds/service'
import { refundTransition } from '../../src/modules/refunds/state'
import type { SalePerformance } from '../../src/modules/shows'
import { memoryTicketsStore } from '../../src/modules/tickets/memoryStore'
import { ticketNotificationHandlers } from '../../src/modules/tickets/notifications'
import { noPerformanceLookup } from '../../src/modules/tickets/performances'
import { createTicketsService } from '../../src/modules/tickets/service'
import { createWalletService, memoryWalletStore } from '../../src/modules/wallet/service'

// Возвраты (T-052, T-053, T-064): правила, state-machine, деньги один раз, бонусы и долг,
// таймаут банка и сверка, сквозной сценарий покупка → возврат → письмо на учебном банке.
const NOW = new Date('2026-11-20T10:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const STARTS = '2026-11-23T19:00:00+05:00'
const STAFF = { kind: 'staff' as const, staffId: '7', role: 'cashier' }

const performance = (capacity = 10, id = 'perf-1', startsAt = STARTS): SalePerformance =>
  ({
    id,
    startsAt,
    show: { slug: 'besy', title: 'Бесы' },
    venue: { id: 'loft', title: 'Лофт', address: 'ул. Ленина, 1', kind: 'loft' },
    ticketTypes: [{ id: 'std', title: 'Стандарт', priceKopecks: 150_000, capacity }],
    seating: null,
  }) as unknown as SalePerformance

let keySeq = 0
const key = () => `key-${String(++keySeq).padStart(16, '0')}`

const setup = (policy: Partial<RefundPolicy> = { customerRefundsEnabled: true }) => {
  let clock = NOW
  const now = () => clock
  const lines: string[] = []
  const log = createLogger({ level: 'debug', write: (l) => lines.push(l) })
  const store = memoryCommerceStore()
  const orders = createOrderService({ store, ticketSecret: 'test-ticket-secret' })
  const walletStore = memoryWalletStore()
  const wallet = createWalletService({ store: walletStore, secret: 'test-wallet-secret-0123' })
  const bankState = fakeBankState()
  const fake = createFakeProvider({ secret: 'fake-bank-secret', state: bankState, now })
  const call = { sleep: async () => {}, timeoutMs: 1_000 }
  const purchase = createPurchaseService({
    orders,
    inventory: createInventoryService({ store }),
    stock: store,
    wallet,
    provider: fake.provider,
    statusSecret: 'status-secret',
    log,
    now,
    call,
    allowPlaceholderPrices: true,
  })
  const refunds = createRefundService({ store, provider: fake.provider, wallet, log, now, call })
  const setPolicy = (p: Partial<RefundPolicy>) =>
    store.transaction((tx) =>
      tx.upsertSetting({
        key: REFUND_POLICY_KEY,
        value: { ...DEFAULT_REFUND_POLICY, ...p },
        updatedBy: 'test',
        updatedAt: clock,
      }),
    )

  /** Купить и оплатить (уведомление банка). */
  const buyPaid = async (
    opts: {
      customerId?: string | null
      quantity?: number
      bonus?: number
      perf?: SalePerformance
    } = {},
  ) => {
    const placed = await purchase.checkout({
      clientKey: key(),
      performance: opts.perf ?? performance(),
      selection: { kind: 'tickets', quantities: { std: opts.quantity ?? 2 } },
      email: 'buyer@example.com',
      customerId: opts.customerId === undefined ? 'alice' : opts.customerId,
      requestedBonusKopecks: opts.bonus ?? 0,
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
    const tickets = store
      .dump()
      .tickets.filter((t) => t.orderId === placed.orderId)
      .sort((a, b) => (a.number < b.number ? -1 : 1))
    return { orderId: placed.orderId, orderNumber: placed.orderNumber, payment, tickets }
  }

  const certificate = async (customerId: string, rubles: number) => {
    const [cert] = await wallet.issueCertificates(
      { amountKopecks: rubles * 100, count: 1, issuedBy: 'test' },
      clock,
    )
    expect((await wallet.activateCertificate(customerId, cert!.code, clock)).ok).toBe(true)
  }

  const customerRefund = (numbers: string[], clientKey = key(), customerId = 'alice') =>
    refunds.requestCustomerRefund({ customerId, ticketNumbers: numbers, clientKey })

  const order = (id: string) => store.dump().orders.find((o) => o.id === id)!
  const ticket = (id: string) => store.dump().tickets.find((t) => t.id === id)!
  const bankRefunds = () => [...bankState.refunds.values()]
  const audit = (action: string) => store.dump().audit.filter((a) => a.action === action)

  return {
    store,
    wallet,
    walletStore,
    fake,
    bankState,
    purchase,
    refunds,
    log,
    lines,
    setPolicy,
    ready: setPolicy(policy),
    buyPaid,
    certificate,
    customerRefund,
    order,
    ticket,
    bankRefunds,
    audit,
    tick: (ms: number) => (clock = new Date(clock.getTime() + ms)),
    now,
  }
}

describe('refund policy (placeholders until the theatre decides)', () => {
  it('defaults keep customer refunds off and are marked as placeholders', () => {
    expect(DEFAULT_REFUND_POLICY.customerRefundsEnabled).toBe(false)
    expect(parseRefundPolicy(undefined)).toEqual(DEFAULT_REFUND_POLICY)
    // Битое значение не открывает возврат случайно.
    expect(parseRefundPolicy({ customerRefundsEnabled: 'yes' })).toEqual(DEFAULT_REFUND_POLICY)
    expect(parseRefundPolicy({ customerRefundsEnabled: true }).customerRefundsEnabled).toBe(true)
  })

  it('checks switch, ticket state, show time, deadline and partial refunds', () => {
    const policy = { ...DEFAULT_REFUND_POLICY, customerRefundsEnabled: true }
    const startsAt = new Date('2026-11-23T14:00:00Z')
    const base = { policy, startsAt, now: NOW, requested: 1, refundable: 2 }
    expect(customerRefundBlock({ ...base, policy: DEFAULT_REFUND_POLICY })).toBe('DISABLED')
    expect(customerRefundBlock(base)).toBeNull()
    expect(customerRefundBlock({ ...base, requested: 0 })).toBe('NOT_REFUNDABLE')
    expect(customerRefundBlock({ ...base, startsAt: null })).toBe('SHOW_TIME_UNKNOWN')
    // Ровно на границе срока — ещё можно; минутой позже — нет.
    const edge = new Date(startsAt.getTime() - 72 * HOUR)
    expect(customerRefundBlock({ ...base, now: edge })).toBeNull()
    expect(customerRefundBlock({ ...base, now: new Date(edge.getTime() + MIN) })).toBe(
      'DEADLINE_PASSED',
    )
    expect(customerRefundBlock({ ...base, policy: { ...policy, allowPartial: false } })).toBe(
      'PARTIAL_NOT_ALLOWED',
    )
  })

  it('refund state machine: no way back from final states, repeats are no-ops', () => {
    expect(refundTransition('REQUESTED', 'PROVIDER_PENDING')).toMatchObject({
      ok: true,
      to: 'PENDING',
    })
    expect(refundTransition('PENDING', 'PROVIDER_SUCCEEDED')).toMatchObject({ to: 'SUCCEEDED' })
    expect(refundTransition('SUCCEEDED', 'PROVIDER_SUCCEEDED')).toMatchObject({ noop: true })
    expect(refundTransition('SUCCEEDED', 'PROVIDER_FAILED').ok).toBe(false)
    expect(refundTransition('FAILED', 'PROVIDER_SUCCEEDED').ok).toBe(false)
    expect(refundTransition('MANUAL_REVIEW', 'PROVIDER_SUCCEEDED')).toMatchObject({
      to: 'SUCCEEDED',
    })
    expect(refundTransition('MANUAL_REVIEW', 'PROVIDER_PENDING').ok).toBe(false)
  })
})

describe('refund amounts and rounding', () => {
  it('partial refunds of every ticket add up exactly to the order (allocate shares)', () => {
    // Три билета по 1000,01 ₽, бонусами 1000 ₽ — доли не делятся поровну.
    const bonus = allocate(100_000, [100_001, 100_001, 100_001])
    const tickets = bonus.map((b, i) => ({
      id: `t${i}`,
      number: `TRD-AAAAAAAA-0${i + 1}`,
      cashKopecks: 100_001 - b,
      bonusKopecks: b,
      feeKopecks: [6_667, 6_667, 6_666][i]!,
    }))
    expect(bonus).toEqual([33_334, 33_333, 33_333])
    const each = tickets.map((t) => refundAmounts([t], { includeFee: true }))
    const sum = (k: 'cashKopecks' | 'bonusKopecks' | 'feeKopecks') =>
      each.reduce((n, a) => n + a[k], 0)
    expect(sum('bonusKopecks')).toBe(100_000)
    expect(sum('feeKopecks')).toBe(20_000)
    expect(sum('cashKopecks')).toBe(3 * 100_001 - 100_000 + 20_000)
    expect(refundAmounts(tickets, { includeFee: false }).feeKopecks).toBe(0)

    // Сторно начисления 3% (89 ₽ = 8900 коп.) по частям — ровно всё начисление.
    const parts = tickets.map((t) => reversalShare(8_900, tickets, new Set([t.id])))
    expect(parts.reduce((n, p) => n + p, 0)).toBe(8_900)
    expect(reversalShare(8_900, tickets, new Set(tickets.map((t) => t.id)))).toBe(8_900)
    // Порядок выборки из БД не влияет на доли.
    expect(reversalShare(8_900, [...tickets].reverse(), new Set(['t0']))).toBe(parts[0])
  })
})

describe('customer refund', () => {
  it('disabled by default: the account says «through the box office», staff refunds still work', async () => {
    const s = setup({})
    await s.ready
    const { tickets, orderNumber } = await s.buyPaid()
    const quote = await s.refunds.quoteForCustomer('alice', [tickets[0]!.number])
    expect(quote?.block).toBe('DISABLED')
    expect(await s.customerRefund([tickets[0]!.number])).toEqual({
      ok: false,
      error: 'BLOCKED',
      block: 'DISABLED',
    })
    expect(s.bankRefunds()).toHaveLength(0)
    const staff = await s.refunds.requestStaffRefund({
      staff: STAFF,
      orderNumber,
      ticketNumbers: [],
      reason: 'Отмена спектакля',
      includeFee: true,
      clientKey: key(),
    })
    expect(staff).toMatchObject({ ok: true, refund: { status: 'SUCCEEDED' } })
  })

  it('refunds one ticket: money once, ticket REFUNDED, order PARTIALLY_REFUNDED, seat back on sale, email event', async () => {
    const s = setup()
    await s.ready
    const { orderId, tickets, payment } = await s.buyPaid({ quantity: 2 })
    expect(s.store.dump().inventory[0]).toMatchObject({ sold: 2, held: 0 })
    const quote = await s.refunds.quoteForCustomer('alice', [tickets[0]!.number])
    expect(quote).toMatchObject({
      block: null,
      ticketNumbers: [tickets[0]!.number],
      // Сбор по умолчанию не возвращается — сумма показывается до подтверждения.
      amounts: { cashKopecks: 150_000, bonusKopecks: 0, feeKopecks: 0 },
      feeKeptKopecks: 20_000,
    })

    const result = await s.customerRefund([tickets[0]!.number])
    expect(result).toMatchObject({
      ok: true,
      duplicate: false,
      refund: { status: 'SUCCEEDED', publicStatus: 'succeeded', cashKopecks: 150_000 },
    })
    expect(s.ticket(tickets[0]!.id)).toMatchObject({ status: 'REFUNDED', refundedAt: NOW })
    expect(s.ticket(tickets[1]!.id).status).toBe('ISSUED')
    expect(s.order(orderId).status).toBe('PARTIALLY_REFUNDED')
    expect(s.store.dump().inventory[0]).toMatchObject({ sold: 1 })
    expect(s.bankState.payments.get(payment.id)!.refundedKopecks).toBe(150_000)
    const refundId = result.ok ? result.refund.id : ''
    expect(s.store.dump().outbox.filter((o) => o.kind === 'refund.succeeded')).toEqual([
      expect.objectContaining({ aggregateId: refundId, payload: { refundId } }),
    ])
    expect(s.audit('refund.requested')).toEqual([
      expect.objectContaining({ actor: 'customer:alice', entity: 'refund', entityId: refundId }),
    ])
    expect(s.audit('refund.succeeded')[0]!.result).toContain('providerRefundId=fake_refund_')

    // Второй билет — заказ возвращён полностью.
    expect(await s.customerRefund([tickets[1]!.number])).toMatchObject({ ok: true })
    expect(s.order(orderId).status).toBe('REFUNDED')
    // Возвращённый билет вернуть ещё раз нельзя.
    expect(await s.customerRefund([tickets[0]!.number])).toMatchObject({
      ok: false,
      error: 'NOT_REFUNDABLE',
    })
  })

  it('double click with the same key: one refund, one bank call; foreign tickets are invisible', async () => {
    const s = setup()
    await s.ready
    const { tickets } = await s.buyPaid()
    const k = key()
    const first = await s.customerRefund([tickets[0]!.number], k)
    const again = await s.customerRefund([tickets[0]!.number], k)
    expect(again).toMatchObject({ ok: true, duplicate: true })
    expect(first.ok && again.ok && first.refund.id === again.refund.id).toBe(true)
    expect(s.bankRefunds()).toHaveLength(1)
    // Тот же ключ с другим составом — конфликт, а не чужой возврат.
    expect(await s.customerRefund([tickets[1]!.number], k)).toMatchObject({
      error: 'IDEMPOTENCY_CONFLICT',
    })
    expect(await s.customerRefund([tickets[1]!.number], key(), 'bob')).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    })
    expect(await s.refunds.quoteForCustomer('bob', [tickets[1]!.number])).toBeNull()
  })

  it('parallel requests for the same ticket (different keys): exactly one money refund', async () => {
    const s = setup()
    await s.ready
    s.fake.bank.refunds.mode = 'pending'
    const { tickets, payment } = await s.buyPaid()
    const results = await Promise.all(
      Array.from({ length: 6 }, () => s.customerRefund([tickets[0]!.number])),
    )
    const created = results.filter((r) => r.ok)
    expect(created).toHaveLength(1)
    expect(results.filter((r) => !r.ok && r.error === 'IN_PROGRESS')).toHaveLength(5)
    expect(s.store.dump().refunds).toHaveLength(1)
    expect(s.bankRefunds()).toHaveLength(1)
    expect(s.bankState.payments.get(payment.id)!.refundedKopecks).toBe(150_000)
    // Пока банк не подтвердил — «в процессе», а не «возвращён» (PAY-06).
    expect(created[0]).toMatchObject({ refund: { status: 'PENDING', publicStatus: 'processing' } })
    expect(s.ticket(tickets[0]!.id).status).toBe('REFUND_PENDING')
  })

  it('parallel refunds of different tickets of one order: both succeed, order REFUNDED', async () => {
    const s = setup()
    await s.ready
    const { orderId, tickets, payment } = await s.buyPaid({ quantity: 2 })
    const [a, b] = await Promise.all([
      s.customerRefund([tickets[0]!.number]),
      s.customerRefund([tickets[1]!.number]),
    ])
    expect(a.ok && b.ok).toBe(true)
    expect(s.order(orderId).status).toBe('REFUNDED')
    expect(s.bankState.payments.get(payment.id)!.refundedKopecks).toBe(300_000)
    expect(s.store.dump().inventory[0]).toMatchObject({ sold: 0 })
  })

  it('deadline and partial rules are rechecked by the server; staff bypasses the deadline', async () => {
    const s = setup({ customerRefundsEnabled: true, allowPartial: false })
    await s.ready
    const { tickets, orderNumber } = await s.buyPaid({ quantity: 2 })
    expect(await s.customerRefund([tickets[0]!.number])).toMatchObject({
      error: 'BLOCKED',
      block: 'PARTIAL_NOT_ALLOWED',
    })
    // Предпросмотр сразу предлагает весь заказ.
    const quote = await s.refunds.quoteForCustomer('alice', [tickets[0]!.number])
    expect(quote).toMatchObject({ block: null, ticketNumbers: tickets.map((t) => t.number) })

    s.tick(3 * 24 * HOUR) // до показа меньше 72 часов
    expect(await s.customerRefund(tickets.map((t) => t.number))).toMatchObject({
      error: 'BLOCKED',
      block: 'DEADLINE_PASSED',
    })
    const staff = await s.refunds.requestStaffRefund({
      staff: STAFF,
      orderNumber,
      ticketNumbers: [tickets[0]!.number],
      reason: 'Болезнь зрителя, справка',
      includeFee: true,
      clientKey: key(),
    })
    // Сотрудник: срок не действует, сбор возвращён по его решению, причина — в журнале.
    expect(staff).toMatchObject({ ok: true, refund: { cashKopecks: 170_000, feeKopecks: 20_000 } })
    expect(s.audit('refund.requested').at(-1)).toMatchObject({
      actor: 'staff:7',
      reason: 'Болезнь зрителя, справка',
    })
  })

  it('staff refund requires a reason; returnToSale=false keeps the quota sold', async () => {
    const s = setup({ customerRefundsEnabled: true, returnToSale: false })
    await s.ready
    const { orderNumber, orderId } = await s.buyPaid({ quantity: 2 })
    const base = {
      staff: STAFF,
      orderNumber,
      ticketNumbers: [],
      includeFee: false,
      clientKey: key(),
    }
    expect(await s.refunds.requestStaffRefund({ ...base, reason: '  ' })).toEqual({
      ok: false,
      error: 'INVALID_REASON',
    })
    expect(await s.refunds.requestStaffRefund({ ...base, reason: 'Перенос' })).toMatchObject({
      ok: true,
      refund: { ticketNumbers: expect.arrayContaining([expect.any(String)]) },
    })
    expect(s.order(orderId).status).toBe('REFUNDED')
    expect(s.store.dump().inventory[0]).toMatchObject({ sold: 2 })
  })
})

describe('bank failures and reconciliation', () => {
  it('timeout before the bank processed it: stays «processing», reconcile completes it once', async () => {
    const s = setup()
    await s.ready
    const { tickets, payment } = await s.buyPaid()
    // Первая попытка — таймаут; повтор внутри callProvider с тем же ключом проходит.
    s.fake.bank.faults.refund = { kind: 'timeout' }
    const call = await s.customerRefund([tickets[0]!.number])
    expect(call).toMatchObject({ ok: true, refund: { status: 'SUCCEEDED' } })
    expect(s.bankRefunds()).toHaveLength(1)
    expect(s.bankState.payments.get(payment.id)!.refundedKopecks).toBe(150_000)
  })

  it('response lost after the bank refunded: reconcile repeats with the same key, no second refund', async () => {
    const s = setup()
    await s.ready
    const { tickets, payment } = await s.buyPaid()
    const provider = s.fake.provider
    const original = provider.refund.bind(provider)
    let lose = 3 // все попытки одного вызова теряют ответ
    provider.refund = async (input, signal) => {
      const r = await original(input, signal)
      if (lose-- > 0) throw new Error('socket hang up')
      return r
    }
    const first = await s.customerRefund([tickets[0]!.number])
    expect(first).toMatchObject({
      ok: true,
      refund: { status: 'REQUESTED', publicStatus: 'processing' },
    })
    expect(s.ticket(tickets[0]!.id).status).toBe('REFUND_PENDING')
    // До паузы сверка банк не трогает; после — повтор с тем же ключом.
    expect((await s.refunds.reconcile()).checked).toBe(0)
    s.tick(2 * MIN)
    expect(await s.refunds.reconcile()).toMatchObject({ checked: 1, succeeded: 1 })
    expect(s.bankRefunds()).toHaveLength(1)
    expect(s.bankState.payments.get(payment.id)!.refundedKopecks).toBe(150_000)
    expect(s.ticket(tickets[0]!.id).status).toBe('REFUNDED')
    // Повтор сверки — ничего.
    s.tick(HOUR)
    expect((await s.refunds.reconcile()).checked).toBe(0)
  })

  it('pending at the bank → reconcile asks again → succeeded; bank cancel → tickets valid again', async () => {
    const s = setup()
    await s.ready
    s.fake.bank.refunds.mode = 'pending'
    const { tickets } = await s.buyPaid({ quantity: 2 })
    const a = await s.customerRefund([tickets[0]!.number])
    const b = await s.customerRefund([tickets[1]!.number])
    if (!a.ok || !b.ok) throw new Error('refunds not opened')
    const [ra, rb] = s.bankRefunds()
    s.tick(2 * MIN)
    expect(await s.refunds.reconcile()).toMatchObject({ checked: 2, pending: 2 })
    s.fake.bank.settleRefund(ra!.providerRefundId, 'succeeded')
    s.fake.bank.settleRefund(rb!.providerRefundId, 'canceled')
    s.tick(5 * MIN)
    expect(await s.refunds.reconcile()).toMatchObject({ succeeded: 1, failed: 1 })
    expect(s.ticket(tickets[0]!.id).status).toBe('REFUNDED')
    expect(s.ticket(tickets[1]!.id).status).toBe('ISSUED')
    expect(
      s.store.dump().refundTickets.find((r) => r.refundId === b.refund.id)!.voidedAt,
    ).not.toBeNull()
    // Отклонённый возврат можно запросить снова.
    s.fake.bank.refunds.mode = 'succeeded'
    expect(await s.customerRefund([tickets[1]!.number])).toMatchObject({
      ok: true,
      refund: { status: 'SUCCEEDED' },
    })
  })

  it('bank rejects: FAILED, tickets valid, alert for staff', async () => {
    const s = setup()
    await s.ready
    const { tickets, orderId } = await s.buyPaid()
    s.fake.bank.faults.refund = { kind: 'rejected' }
    expect(await s.customerRefund([tickets[0]!.number])).toMatchObject({
      ok: true,
      refund: { status: 'FAILED', publicStatus: 'failed' },
    })
    expect(s.ticket(tickets[0]!.id).status).toBe('ISSUED')
    expect(s.order(orderId).status).toBe('PAID')
    expect(
      s.lines.some((l) => l.includes('ALERT_PAYMENT_REVIEW') && l.includes('REFUND_FAILED')),
    ).toBe(true)
  })

  it('unknown outcome too many times → MANUAL_REVIEW; staff retry with the same key finishes it', async () => {
    const s = setup()
    await s.ready
    const { tickets } = await s.buyPaid()
    const provider = s.fake.provider
    const original = provider.refund.bind(provider)
    let down = true
    provider.refund = async (input, signal) => {
      if (down) throw new Error('ECONNRESET')
      return original(input, signal)
    }
    const opened = await s.customerRefund([tickets[0]!.number])
    if (!opened.ok) throw new Error('not opened')
    for (let i = 0; i < MAX_UNKNOWN_ATTEMPTS + 2; i++) {
      s.tick(2 * HOUR)
      await s.refunds.reconcile()
    }
    expect((await s.refunds.refund(opened.refund.id))?.status).toBe('MANUAL_REVIEW')
    expect(s.ticket(tickets[0]!.id).status).toBe('REFUND_PENDING')
    expect(s.lines.some((l) => l.includes('REFUND_STUCK'))).toBe(true)
    down = false
    expect(await s.refunds.retryRefund(opened.refund.id, STAFF, 'Банк ответил')).toMatchObject({
      status: 'SUCCEEDED',
    })
    expect(s.bankRefunds()).toHaveLength(1)
    expect(s.audit('refund.retry')[0]).toMatchObject({ actor: 'staff:7', reason: 'Банк ответил' })
  })

  it('worker job runs the reconciliation', async () => {
    const s = setup()
    await s.ready
    let runs = 0
    const job = refundsReconcileJob({
      refunds: async () => ({
        reconcile: async () => {
          runs++
          return s.refunds.reconcile()
        },
      }),
      log: s.log,
    })
    expect(job.name).toBe('refunds.reconcile')
    await job.run()
    expect(runs).toBe(1)
  })
})

describe('bonuses on refund (PRD §5.6 debt rule)', () => {
  it('spent bonuses come back and the 3% accrual is reversed proportionally', async () => {
    const s = setup()
    await s.ready
    await s.certificate('alice', 1000)
    // 2 билета по 1500 ₽, бонусами 900 ₽ (30%) → по 450 ₽ на билет; 3% от 2100 ₽ = 63 ₽.
    const { tickets, orderId } = await s.buyPaid({ quantity: 2, bonus: 90_000 })
    expect(s.order(orderId).bonusKopecks).toBe(90_000)
    expect(await s.wallet.balance('alice', s.now())).toBe(10_000 + 6_300)
    expect(tickets.map((t) => t.bonusKopecks)).toEqual([45_000, 45_000])

    const first = await s.customerRefund([tickets[0]!.number])
    expect(first).toMatchObject({
      ok: true,
      refund: { cashKopecks: 105_000, bonusKopecks: 45_000 },
    })
    const settled = first.ok ? await s.refunds.refund(first.refund.id) : null
    expect(settled).toMatchObject({ bonusReversalKopecks: 3_150, bonusSettledAt: NOW })
    expect(await s.wallet.balance('alice', s.now())).toBe(16_300 + 45_000 - 3_150)
    await s.customerRefund([tickets[1]!.number])
    expect(await s.wallet.balance('alice', s.now())).toBe(100_000)
    expect(await s.wallet.debt('alice')).toBe(0)
    // Исходные строки на месте; компенсации — новыми строками.
    const kinds = s.walletStore.dump().ledger.map((e) => e.kind)
    expect(kinds.filter((k) => k === 'refund')).toHaveLength(2)
    expect(kinds.filter((k) => k === 'reversal')).toHaveLength(2)
    expect(kinds).toContain('purchase')
    // Повтор компенсации ничего не удваивает.
    if (first.ok) await s.refunds.settleBonuses(first.refund.id)
    expect(await s.wallet.balance('alice', s.now())).toBe(100_000)
  })

  it('earned bonuses already spent: balance never negative, debt kept in the ledger and repaid by the next accrual', async () => {
    const s = setup()
    await s.ready
    // Заказ A: 2 × 1500 ₽ деньгами → начислено 90 ₽.
    const a = await s.buyPaid({ quantity: 2 })
    expect(await s.wallet.balance('alice', s.now())).toBe(9_000)
    // Заказ B: 90 ₽ потрачены; начислено 3% от 1410 ₽ = 42 ₽ (вниз до рубля).
    await s.buyPaid({ quantity: 1, bonus: 9_000 })
    expect(await s.wallet.balance('alice', s.now())).toBe(4_200)

    // Возврат A целиком: сторно 90 ₽, покрыто 42 ₽ из баланса, 48 ₽ — долг.
    const refunded = await s.refunds.requestStaffRefund({
      staff: STAFF,
      orderNumber: a.orderNumber,
      ticketNumbers: [],
      reason: 'Отмена',
      includeFee: false,
      clientKey: key(),
    })
    expect(refunded).toMatchObject({ ok: true, refund: { bonusReversalKopecks: 9_000 } })
    expect(await s.wallet.balance('alice', s.now())).toBe(0)
    expect(await s.wallet.debt('alice')).toBe(4_800)
    const settled = s.audit('refund.bonus_settled').at(-1)!
    expect(settled.result).toContain('covered=4200 debt=4800')

    // Следующее начисление (45 ₽) гасит долг; доступный баланс не уходит в минус.
    await s.buyPaid({ quantity: 1 })
    expect(await s.wallet.debt('alice')).toBe(300)
    expect(await s.wallet.balance('alice', s.now())).toBe(0)
    await s.buyPaid({ quantity: 1 })
    expect(await s.wallet.debt('alice')).toBe(0)
    expect(await s.wallet.balance('alice', s.now())).toBe(4_500 - 300)
  })

  it('guest order: no wallet, refund still settles', async () => {
    const s = setup()
    await s.ready
    const { orderNumber } = await s.buyPaid({ customerId: null, quantity: 1 })
    const r = await s.refunds.requestStaffRefund({
      staff: STAFF,
      orderNumber,
      ticketNumbers: [],
      reason: 'Гость попросил по почте',
      includeFee: false,
      clientKey: key(),
    })
    expect(r).toMatchObject({ ok: true, refund: { status: 'SUCCEEDED' } })
    expect(s.store.dump().refunds[0]!.bonusSettledAt).not.toBeNull()
  })
})

describe('end to end: purchase → refund → email on the fake bank', () => {
  it('sends the refund email from the outbox; ticket and order data come from the snapshot', async () => {
    const s = setup()
    await s.ready
    const { tickets } = await s.buyPaid({ quantity: 2 })
    const item = s.store.dump().items[0]!
    expect(item).toMatchObject({
      showTitleSnapshot: 'Бесы',
      showSlugSnapshot: 'besy',
      startsAtSnapshot: new Date(STARTS),
      venueTitleSnapshot: 'Лофт',
      venueAddressSnapshot: 'ул. Ленина, 1',
    })
    const result = await s.customerRefund([tickets[1]!.number])
    if (!result.ok) throw new Error('refund failed')

    const store = memoryTicketsStore(s.store)
    const ticketsService = createTicketsService({
      store,
      secret: 'tickets-secret',
      performances: () => noPerformanceLookup,
    })
    const sent: EmailMessage[] = []
    const handlers = ticketNotificationHandlers({
      store,
      tickets: ticketsService,
      // Как в worker: без афиши — только снимки.
      performances: () => noPerformanceLookup,
      provider: { send: async (m: EmailMessage) => void sent.push(m) },
      siteUrl: 'https://teatrturdus.ru',
      theatreEmail: null,
    })
    const event = s.store.dump().outbox.find((o) => o.kind === 'refund.succeeded')!
    await handlers['refund.succeeded']!({
      id: event.id,
      kind: event.kind,
      dedupeKey: event.dedupeKey,
      aggregateId: event.aggregateId,
      payload: event.payload,
      attempts: 1,
      createdAt: event.createdAt,
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('buyer@example.com')
    expect(sent[0]!.subject).toContain('выполнен')
    expect(sent[0]!.text).toContain(tickets[1]!.number)

    // Письмо с билетами — тоже из снимка, без демо-данных афиши; возвращённого билета в нём нет.
    const paid = s.store.dump().outbox.find((o) => o.kind === 'order.paid')!
    await handlers['order.paid']!({
      id: paid.id,
      kind: paid.kind,
      dedupeKey: paid.dedupeKey,
      aggregateId: paid.aggregateId,
      payload: paid.payload,
      attempts: 1,
      createdAt: paid.createdAt,
    })
    expect(sent[1]!.text).toContain('Бесы')
    expect(sent[1]!.text).toContain('Лофт')
    expect(sent[1]!.text).toContain(tickets[0]!.number)
    expect(sent[1]!.text).not.toContain(tickets[1]!.number)

    // Кабинет: билет из снимка, состояние — с сервера.
    const account = await ticketsService.accountTickets('alice', s.now())
    expect(account.upcoming.map((t) => [t.show?.title, t.venue?.title])).toEqual([['Бесы', 'Лофт']])
    expect(account.refunded[0]).toMatchObject({ number: tickets[1]!.number, state: 'refunded' })
  })
})
