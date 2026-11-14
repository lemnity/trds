import { describe, expect, it } from 'vitest'

import { createLogger } from '../../src/lib/log'
import { createInventoryService } from '../../src/modules/inventory/inventory'
import { memoryCommerceStore } from '../../src/modules/inventory/memoryStore'
import { createPurchaseService } from '../../src/modules/orders/purchase'
import { createOrderService } from '../../src/modules/orders/service'
import { createFakeProvider, fakeBankState } from '../../src/modules/payments'
import { memoryClaimFileStorage } from '../../src/modules/refund-claims/files'
import { createClaimService } from '../../src/modules/refund-claims/service'
import { memoryClaimStore } from '../../src/modules/refund-claims/store'
import { refundAmounts } from '../../src/modules/refunds/amounts'
import {
  assessClaim,
  endOfTheatreDay,
  LEGAL_MIN_TIERS,
} from '../../src/modules/refunds/claims-policy'
import {
  DEFAULT_REFUND_POLICY,
  parseRefundPolicy,
  REFUND_POLICY_KEY,
  refundPolicySchema,
} from '../../src/modules/refunds/policy'
import { createRefundService } from '../../src/modules/refunds/service'
import type { SalePerformance } from '../../src/modules/shows'
import { createWalletService, memoryWalletStore } from '../../src/modules/wallet/service'

const TZ = 'Asia/Yekaterinburg'
const DAY = 24 * 60 * 60_000
const STARTS = new Date('2026-12-20T14:00:00Z') // 19:00 по Екатеринбургу
const at = (daysBefore: number) => new Date(STARTS.getTime() - daysBefore * DAY)
const assess = (daysBefore: number, extra: Partial<Parameters<typeof assessClaim>[0]> = {}) =>
  assessClaim({
    startsAt: STARTS,
    now: at(daysBefore),
    reason: 'CHANGED_MIND',
    promo: false,
    tiers: LEGAL_MIN_TIERS,
    timeZone: TZ,
    ...extra,
  })

describe('правила возврата по заявке (ст. 52.1, ПП № 1491)', () => {
  it('больше 10 дней — 100%; ровно 10 и до 5 — 50%; от 5 до 3 — 30%; меньше 3 — 0', () => {
    expect(assess(11)).toMatchObject({ percent: 100, basis: 'MORE_THAN_10_DAYS' })
    expect(assess(10)).toMatchObject({ percent: 50, basis: 'FROM_5_TO_10_DAYS' })
    expect(assess(5)).toMatchObject({ percent: 50, basis: 'FROM_5_TO_10_DAYS' })
    expect(assess(4)).toMatchObject({ percent: 30, basis: 'FROM_3_TO_5_DAYS' })
    expect(assess(3)).toMatchObject({ percent: 30, basis: 'FROM_3_TO_5_DAYS' })
    expect(assess(2.9)).toMatchObject({ percent: 0, basis: 'LESS_THAN_3_DAYS' })
  })

  it('театр может поднять проценты', () => {
    const tiers = { halfPercent: 70, lowPercent: 40 }
    expect(assess(7, { tiers }).percent).toBe(70)
    expect(assess(4, { tiers }).percent).toBe(40)
  })

  it('акционный билет — 0, кроме болезни, смерти близкого и переноса/отмены', () => {
    expect(assess(20, { promo: true })).toMatchObject({ percent: 0, basis: 'PROMO' })
    expect(assess(1, { promo: true, reason: 'ILLNESS' })).toMatchObject({
      percent: 100,
      basis: 'DOCUMENTED',
      documentRequired: true,
    })
    expect(assess(1, { promo: true, reason: 'EVENT_CHANGED' })).toMatchObject({
      percent: 100,
      includeFee: true,
    })
  })

  it('болезнь и смерть близкого — 100% с документом в течение 14 дней после спектакля', () => {
    const a = assess(0.1, { reason: 'RELATIVE_DEATH' })
    expect(a).toMatchObject({ percent: 100, documentRequired: true, canSubmit: true })
    const dayEnd = endOfTheatreDay(STARTS, TZ)
    expect(dayEnd.toISOString()).toBe('2026-12-20T18:59:59.999Z')
    expect(a.documentDeadline!.getTime()).toBe(dayEnd.getTime() + 14 * DAY)
  })

  it('заявку можно подать до конца дня спектакля, позже — нельзя', () => {
    expect(assess(-0.1, { reason: 'ILLNESS' }).canSubmit).toBe(true) // после начала, тот же день
    expect(assess(-0.3, { reason: 'ILLNESS' }).canSubmit).toBe(false) // следующий день
  })

  it('сбор возвращается только при переносе/отмене', () => {
    expect(assess(20).includeFee).toBe(false)
    expect(assess(20, { reason: 'EVENT_CHANGED' }).includeFee).toBe(true)
  })

  it('настройки не опускают проценты ниже минимума закона', () => {
    const base = { ...DEFAULT_REFUND_POLICY }
    expect(refundPolicySchema.safeParse({ ...base, halfPercent: 40 }).success).toBe(false)
    expect(refundPolicySchema.safeParse({ ...base, lowPercent: 20 }).success).toBe(false)
    expect(refundPolicySchema.safeParse({ ...base, halfPercent: 60, lowPercent: 35 }).success).toBe(
      true,
    )
    // Старые сохранённые настройки без процентов — минимумы закона.
    expect(parseRefundPolicy({ customerRefundsEnabled: false })).toMatchObject(LEGAL_MIN_TIERS)
  })

  it('часть номинала: деньги и бонусы в одной пропорции, копейки вниз, сбор целиком или нет', () => {
    const t = { id: 'a', cashKopecks: 100_001, bonusKopecks: 50_001, feeKopecks: 10_000 }
    expect(refundAmounts([t], { includeFee: false, percent: 50 })).toMatchObject({
      cashKopecks: 50_000,
      bonusKopecks: 25_000,
      feeKopecks: 0,
    })
    expect(refundAmounts([t], { includeFee: true, percent: 30 })).toMatchObject({
      cashKopecks: 30_000 + 10_000,
      feeKopecks: 10_000,
    })
    expect(() => refundAmounts([t], { includeFee: false, percent: 0 })).toThrow()
  })
})

// --- Заявка целиком: подача → документы → решение сотрудника → возврат через банк ---

let keySeq = 0
const key = () => `key-${String(++keySeq).padStart(16, '0')}`
const STAFF = { kind: 'staff' as const, staffId: '7', email: 'kassa@turdus.ru', role: 'admin' }
const PDF = Buffer.from('%PDF-1.7\n…')

const setup = ({ daysBefore = 7, promo = false } = {}) => {
  let clock = at(daysBefore)
  const now = () => clock
  const log = createLogger({ level: 'error', write: () => {} })
  const store = memoryCommerceStore()
  const orders = createOrderService({ store, ticketSecret: 'test-ticket-secret' })
  const wallet = createWalletService({
    store: memoryWalletStore(),
    secret: 'test-wallet-secret-0123',
  })
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
  const ready = store.transaction((tx) =>
    tx.upsertSetting({
      key: REFUND_POLICY_KEY,
      value: DEFAULT_REFUND_POLICY,
      updatedBy: 'test',
      updatedAt: clock,
    }),
  )
  const claims = createClaimService({
    claims: memoryClaimStore(),
    commerce: store,
    files: memoryClaimFileStorage(),
    policy: refunds.policy,
    staffRefund: (input) => refunds.requestStaffRefund(input),
    isPromo: () => promo,
    performance: () => null,
    timeZone: TZ,
    log,
    now,
  })

  const buy = async (customerId = 'alice') => {
    await ready
    const placed = await purchase.checkout({
      clientKey: key(),
      performance: {
        id: 'perf-1',
        startsAt: STARTS.toISOString(),
        show: { slug: 'besy', title: 'Бесы' },
        venue: { id: 'loft', title: 'Лофт', address: 'ул. Ленина, 1', kind: 'loft' },
        ticketTypes: [{ id: 'std', title: 'Стандарт', priceKopecks: 150_000, capacity: 10 }],
        seating: null,
      } as unknown as SalePerformance,
      selection: { kind: 'tickets', quantities: { std: 2 } },
      email: 'buyer@example.com',
      customerId,
      requestedBonusKopecks: 0,
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
    return store
      .dump()
      .tickets.filter((t) => t.orderId === placed.orderId)
      .sort((a, b) => (a.number < b.number ? -1 : 1))
  }

  return {
    claims,
    store,
    buy,
    bankRefunds: () => [...bankState.refunds.values()],
    tick: (ms: number) => (clock = new Date(clock.getTime() + ms)),
  }
}

describe('заявка на возврат', () => {
  it('за 7 дней: заявка с 50%, билеты действуют до решения; повтор по тем же билетам — нельзя', async () => {
    const s = setup({ daysBefore: 7 })
    const [t1] = await s.buy()
    const q = await s.claims.quote('alice', [t1!.number], 'CHANGED_MIND')
    expect(q.ok && q.value).toMatchObject({
      assessment: { percent: 50, basis: 'FROM_5_TO_10_DAYS' },
      amounts: { cashKopecks: 75_000, feeKopecks: 0 },
    })
    const r = await s.claims.submit({
      customerId: 'alice',
      ticketNumbers: [t1!.number],
      reason: 'CHANGED_MIND',
      comment: 'Уезжаю',
    })
    expect(r.ok && r.value).toMatchObject({ status: 'SUBMITTED', legalPercent: 50 })
    expect(s.store.dump().tickets.find((t) => t.id === t1!.id)!.status).toBe('ISSUED')
    const again = await s.claims.submit({
      customerId: 'alice',
      ticketNumbers: [t1!.number],
      reason: 'OTHER',
    })
    expect(again).toMatchObject({ ok: false, error: 'ALREADY_CLAIMED' })
  })

  it('чужие билеты не видны; после дня спектакля заявку не подать', async () => {
    const s = setup({ daysBefore: 7 })
    const [t1] = await s.buy()
    expect(
      await s.claims.submit({ customerId: 'bob', ticketNumbers: [t1!.number], reason: 'OTHER' }),
    ).toMatchObject({ ok: false, error: 'NOT_FOUND' })
    s.tick(8 * DAY)
    expect(
      await s.claims.submit({
        customerId: 'alice',
        ticketNumbers: [t1!.number],
        reason: 'ILLNESS',
      }),
    ).toMatchObject({ ok: false, error: 'TOO_LATE' })
  })

  it('одобрение с процентом создаёт возврат через банк; двойное одобрение — один возврат', async () => {
    const s = setup({ daysBefore: 7 })
    const [t1] = await s.buy()
    const r = await s.claims.submit({
      customerId: 'alice',
      ticketNumbers: [t1!.number],
      reason: 'CHANGED_MIND',
    })
    if (!r.ok) throw new Error(r.error)
    const approved = await s.claims.approve({
      staff: STAFF,
      claimId: r.value.id,
      percent: 50,
      includeFee: false,
    })
    expect(approved.ok && approved.value).toMatchObject({
      status: 'APPROVED',
      decidedPercent: 50,
      decidedBy: 'kassa@turdus.ru',
    })
    expect(s.bankRefunds()).toHaveLength(1)
    expect(s.bankRefunds()[0]).toMatchObject({ amountKopecks: 75_000 })
    const twice = await s.claims.approve({
      staff: STAFF,
      claimId: r.value.id,
      percent: 50,
      includeFee: false,
    })
    expect(twice).toMatchObject({ ok: false, error: 'CLOSED' })
    expect(s.bankRefunds()).toHaveLength(1)
  })

  it('отказ — только с объяснением; после отказа билет снова можно заявить', async () => {
    const s = setup({ daysBefore: 2 })
    const [t1] = await s.buy()
    const r = await s.claims.submit({
      customerId: 'alice',
      ticketNumbers: [t1!.number],
      reason: 'CHANGED_MIND',
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.value.legalPercent).toBe(0)
    expect(await s.claims.reject({ staff: STAFF, claimId: r.value.id, comment: '' })).toMatchObject(
      { ok: false, error: 'DECISION_COMMENT' },
    )
    const rejected = await s.claims.reject({
      staff: STAFF,
      claimId: r.value.id,
      comment: 'Меньше трёх дней: по закону возврат не положен. Билет можно передать.',
    })
    expect(rejected.ok && rejected.value.status).toBe('REJECTED')
    expect(s.bankRefunds()).toHaveLength(0)
    const next = await s.claims.submit({
      customerId: 'alice',
      ticketNumbers: [t1!.number],
      reason: 'ILLNESS',
    })
    expect(next.ok && next.value).toMatchObject({ legalPercent: 100, documentRequired: true })
  })

  it('документы: только PDF/фото, только свои, до 14 дней после спектакля', async () => {
    const s = setup({ daysBefore: 1 })
    const [t1] = await s.buy()
    const r = await s.claims.submit({
      customerId: 'alice',
      ticketNumbers: [t1!.number],
      reason: 'ILLNESS',
    })
    if (!r.ok) throw new Error(r.error)
    const id = r.value.id
    expect(
      await s.claims.addFile({
        customerId: 'alice',
        claimId: id,
        name: 'x.exe',
        bytes: Buffer.from('MZ…'),
      }),
    ).toMatchObject({ ok: false, error: 'FILE_TYPE' })
    expect(
      await s.claims.addFile({ customerId: 'bob', claimId: id, name: 'a.pdf', bytes: PDF }),
    ).toMatchObject({ ok: false, error: 'NOT_FOUND' })
    const added = await s.claims.addFile({
      customerId: 'alice',
      claimId: id,
      name: '../../больничный.pdf',
      bytes: PDF,
    })
    expect(added.ok && added.value).toMatchObject({
      mimeType: 'application/pdf',
      originalName: '.._.._больничный.pdf',
    })
    const file = await s.claims.fileForStaff(added.ok ? added.value.id : '')
    expect(file?.bytes.equals(PDF)).toBe(true)
    s.tick(16 * DAY)
    expect(
      await s.claims.addFile({ customerId: 'alice', claimId: id, name: 'b.pdf', bytes: PDF }),
    ).toMatchObject({ ok: false, error: 'DOCUMENT_DEADLINE' })
  })

  it('акционный билет: по закону 0%, но заявку подать можно — решает сотрудник', async () => {
    const s = setup({ daysBefore: 20, promo: true })
    const [t1] = await s.buy()
    const r = await s.claims.submit({
      customerId: 'alice',
      ticketNumbers: [t1!.number],
      reason: 'CHANGED_MIND',
    })
    expect(r.ok && r.value).toMatchObject({ legalPercent: 0, basis: 'PROMO' })
  })

  it('зритель может отозвать свою заявку', async () => {
    const s = setup({ daysBefore: 7 })
    const [t1] = await s.buy()
    const r = await s.claims.submit({
      customerId: 'alice',
      ticketNumbers: [t1!.number],
      reason: 'OTHER',
    })
    if (!r.ok) throw new Error(r.error)
    const c = await s.claims.cancel('alice', r.value.id)
    expect(c.ok && c.value.status).toBe('CANCELLED')
    expect(await s.claims.cancel('alice', r.value.id)).toMatchObject({ ok: false, error: 'CLOSED' })
  })
})
