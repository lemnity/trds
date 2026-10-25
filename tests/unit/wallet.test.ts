import { describe, expect, it } from 'vitest'

import {
  bonusExpiresAt,
  generateCertificateCode,
  parseCertificateCode,
} from '../../src/modules/loyalty'
import { createWalletService, memoryWalletStore } from '../../src/modules/wallet/service'

const SECRET = 'test-secret-test-secret-test-secret-123'
const NOW = new Date('2026-10-25T10:00:00Z')
const DAY = 86_400_000
const at = (days: number) => new Date(NOW.getTime() + days * DAY)

const setup = () => {
  const store = memoryWalletStore()
  const wallet = createWalletService({ store, secret: SECRET })
  return { store, wallet }
}

const issueOne = async (
  wallet: ReturnType<typeof setup>['wallet'],
  extra: { amountKopecks?: number; validUntil?: Date } = {},
) => {
  const [cert] = await wallet.issueCertificates(
    {
      amountKopecks: extra.amountKopecks ?? 300_000,
      count: 1,
      validUntil: extra.validUntil,
      issuedBy: 'касса',
    },
    NOW,
  )
  return cert!
}

describe('certificates', () => {
  it('issues codes with serials and stores no plaintext code', async () => {
    const { wallet, store } = setup()
    const issued = await wallet.issueCertificates(
      { amountKopecks: 500_000, count: 3, comment: 'партия', issuedBy: 'касса' },
      NOW,
    )
    expect(issued.map((c) => c.serial)).toEqual(['С-000001', 'С-000002', 'С-000003'])
    const stored = JSON.stringify(store.dump())
    for (const { code } of issued) {
      const parsed = parseCertificateCode(code)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(stored).not.toContain(parsed.canonical)
      expect(stored).not.toContain(code)
    }
    const rows = store.dump().certificates
    expect(rows.map((r) => r.last4)).toEqual(
      issued.map((c) => c.code.replaceAll('-', '').slice(-4)),
    )
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.codeHash) && r.status === 'issued')).toBe(true)
  })

  it('retries on hash collision and rejects bad input', async () => {
    // Первые два номера одинаковые: второй выпуск должен повторить генерацию.
    const sequence = [...Array(12).fill(0), ...Array(12).fill(0), ...Array(12).fill(1)]
    let i = 0
    const store = memoryWalletStore()
    const wallet = createWalletService({
      store,
      secret: SECRET,
      randomInt: (max) => (sequence[i++] ?? 2) % max,
    })
    const issued = await wallet.issueCertificates(
      { amountKopecks: 100_000, count: 2, issuedBy: 'x' },
      NOW,
    )
    expect(new Set(issued.map((c) => c.code)).size).toBe(2)
    // Третий сгенерированный номер — после совпадения хеша второго.
    expect(i).toBe(33)
    expect(store.dump().certificates).toHaveLength(2)
    await expect(
      wallet.issueCertificates({ amountKopecks: 100_050, count: 1, issuedBy: 'x' }, NOW),
    ).rejects.toThrow(RangeError)
    await expect(
      wallet.issueCertificates({ amountKopecks: 100_000, count: 501, issuedBy: 'x' }, NOW),
    ).rejects.toThrow(RangeError)
    await expect(
      wallet.issueCertificates(
        { amountKopecks: 100_000, count: 1, issuedBy: 'x', validUntil: at(-1) },
        NOW,
      ),
    ).rejects.toThrow(RangeError)
  })

  it('activates: credits the nominal as a 1-year lot, no extra accrual', async () => {
    const { wallet, store } = setup()
    const { code } = await issueOne(wallet)
    // Ввод без дефисов, в нижнем регистре и без префикса тоже принимается.
    const typed = code.replace('TRDS-', '').replaceAll('-', ' ').toLowerCase()
    const result = await wallet.activateCertificate('alice', typed, NOW)
    expect(result).toEqual({
      ok: true,
      amountKopecks: 300_000,
      expiresAt: bonusExpiresAt(NOW),
      balanceKopecks: 300_000,
    })
    const { ledger, certificates } = store.dump()
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ kind: 'certificate', amountKopecks: 300_000 })
    expect(ledger.some((e) => e.kind === 'purchase')).toBe(false)
    expect(certificates[0]).toMatchObject({ status: 'activated', activatedByCustomer: 'alice' })

    const summary = await wallet.summary('alice', NOW)
    expect(summary.balanceKopecks).toBe(300_000)
    expect(summary.certificates).toEqual([
      {
        serial: 'С-000001',
        last4: code.slice(-4),
        amountKopecks: 300_000,
        activatedAt: NOW,
        expiresAt: bonusExpiresAt(NOW),
      },
    ])
  })

  it('returns FORMAT / CHECKSUM before touching the store', async () => {
    const { wallet, store } = setup()
    const { code } = await issueOne(wallet)
    const last = code.at(-1)!
    const broken = code.slice(0, -1) + (last === '2' ? '3' : '2')
    let calls = 0
    const original = store.transaction.bind(store)
    store.transaction = (fn) => {
      calls++
      return original(fn)
    }
    expect(await wallet.activateCertificate('alice', 'TRDS-123', NOW)).toEqual({
      ok: false,
      error: 'FORMAT',
    })
    expect(await wallet.activateCertificate('alice', 42, NOW)).toEqual({
      ok: false,
      error: 'FORMAT',
    })
    expect(await wallet.activateCertificate('alice', broken, NOW)).toEqual({
      ok: false,
      error: 'CHECKSUM',
    })
    expect(calls).toBe(0)
  })

  it('same NOT_AVAILABLE for unknown, used, annulled and expired', async () => {
    const { wallet, store } = setup()
    const unknown = generateCertificateCode((max) => Math.floor(Math.random() * max))
    const used = await issueOne(wallet)
    await wallet.activateCertificate('alice', used.code, NOW)
    const annulled = await issueOne(wallet)
    expect(await wallet.annulCertificate(2)).toBe(true)
    // Активированный не аннулируется.
    expect(await wallet.annulCertificate(1)).toBe(false)
    expect(store.dump().certificates.map((c) => c.status)).toEqual(['activated', 'annulled'])
    const expired = await issueOne(wallet, { validUntil: at(10) })

    const results = await Promise.all([
      wallet.activateCertificate('bob', unknown, NOW),
      wallet.activateCertificate('bob', used.code, NOW),
      wallet.activateCertificate('bob', annulled.code, NOW),
      wallet.activateCertificate('bob', expired.code, at(11)),
    ])
    for (const r of results) expect(r).toEqual({ ok: false, error: 'NOT_AVAILABLE' })
    expect((await wallet.summary('bob', NOW)).balanceKopecks).toBe(0)
  })

  it('double and parallel activation credit exactly once', async () => {
    const { wallet, store } = setup()
    const { code } = await issueOne(wallet)
    const results = await Promise.all([
      wallet.activateCertificate('alice', code, NOW),
      wallet.activateCertificate('alice', code, NOW),
      wallet.activateCertificate('bob', code, NOW),
      wallet.activateCertificate('carol', code, NOW),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok && r.error === 'NOT_AVAILABLE')).toHaveLength(3)
    expect(await wallet.activateCertificate('alice', code, NOW)).toEqual({
      ok: false,
      error: 'NOT_AVAILABLE',
    })
    expect(store.dump().ledger.filter((e) => e.kind === 'certificate')).toHaveLength(1)
  })
})

describe('spend and accrue', () => {
  const seed = async () => {
    const ctx = setup()
    // Три лота с разными сроками: 100 ₽ (сгорит раньше всех), 200 ₽, 300 ₽.
    await ctx.wallet.accrue('alice', 1_000_000, 'order-a', at(-300)) // 3% = 300 ₽
    await ctx.wallet.accrue('alice', 333_300, 'order-b', at(-350)) // 99.99 ₽ → 99 ₽ (округление вниз)
    await ctx.wallet.accrue('alice', 666_700, 'order-c', at(-320)) // 200 ₽
    return ctx
  }

  it('accrues 3% once per order and nothing for zero', async () => {
    const { wallet, store } = setup()
    // 3% от 2500 ₽ = 75 ₽.
    expect(await wallet.accrue('alice', 250_000, 'o1', NOW)).toEqual({
      amountKopecks: 7_500,
      duplicate: false,
    })
    expect(await wallet.accrue('alice', 250_000, 'o1', NOW)).toMatchObject({ duplicate: true })
    expect(await wallet.accrue('alice', 3_000, 'o2', NOW)).toEqual({
      amountKopecks: 0,
      duplicate: false,
    })
    const { ledger } = store.dump()
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      kind: 'purchase',
      amountKopecks: 7_500,
      expiresAt: bonusExpiresAt(NOW),
      idempotencyKey: 'purchase:o1',
    })
  })

  it('spends FIFO by expiry and is idempotent', async () => {
    const { wallet, store } = await seed()
    expect(await wallet.balance('alice', NOW)).toBe(59_900)
    const first = await wallet.spend('alice', 15_000, 'order-x', NOW)
    expect(first).toMatchObject({ ok: true, duplicate: false, amountKopecks: 15_000 })
    const again = await wallet.spend('alice', 15_000, 'order-x', NOW)
    expect(again).toMatchObject({ ok: true, duplicate: true })
    if (first.ok && again.ok) expect(again.entryId).toBe(first.entryId)
    expect(await wallet.spend('alice', 20_000, 'order-x', NOW)).toEqual({
      ok: false,
      error: 'IDEMPOTENCY_CONFLICT',
    })
    const { ledger, allocations } = store.dump()
    const byKey = (k: string) => ledger.find((e) => e.idempotencyKey === k)!
    // order-b сгорает первым (99 ₽) → целиком; затем order-c (200 ₽) — 51 ₽.
    expect(byKey('purchase:order-b').lotRemainingKopecks).toBe(0)
    expect(byKey('purchase:order-c').lotRemainingKopecks).toBe(20_000 - 5_100)
    expect(byKey('purchase:order-a').lotRemainingKopecks).toBe(30_000)
    expect(allocations.map((a) => a.kopecks).sort((a, b) => a - b)).toEqual([5_100, 9_900])
    expect(ledger.filter((e) => e.kind === 'spend')).toHaveLength(1)
    expect(await wallet.balance('alice', NOW)).toBe(59_900 - 15_000)
  })

  it('refuses to spend more than the balance and leaves no trace', async () => {
    const { wallet, store } = await seed()
    expect(await wallet.spend('alice', 60_000, 'order-y', NOW)).toEqual({
      ok: false,
      error: 'INSUFFICIENT',
    })
    expect(store.dump().ledger.filter((e) => e.kind === 'spend')).toHaveLength(0)
    expect(store.dump().allocations).toHaveLength(0)
    // Ключ не «сгорел»: тот же заказ с допустимой суммой проходит.
    expect(await wallet.spend('alice', 10_000, 'order-y', NOW)).toMatchObject({ ok: true })
  })

  it('parallel spends never exceed the balance', async () => {
    const { wallet, store } = await seed()
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => wallet.spend('alice', 10_000, `p-${i}`, NOW)),
    )
    expect(results.filter((r) => r.ok)).toHaveLength(5)
    expect(results.filter((r) => !r.ok && r.error === 'INSUFFICIENT')).toHaveLength(5)
    expect(await wallet.balance('alice', NOW)).toBe(9_900)
    const { ledger } = store.dump()
    expect(ledger.every((e) => e.lotRemainingKopecks === null || e.lotRemainingKopecks >= 0)).toBe(
      true,
    )
    const spent = ledger.filter((e) => e.kind === 'spend').reduce((s, e) => s - e.amountKopecks, 0)
    expect(spent).toBe(50_000)
  })

  it('parallel repeats of one order spend once', async () => {
    const { wallet, store } = await seed()
    const results = await Promise.all(
      Array.from({ length: 5 }, () => wallet.spend('alice', 30_000, 'same-order', NOW)),
    )
    expect(results.every((r) => r.ok)).toBe(true)
    expect(results.filter((r) => r.ok && !r.duplicate)).toHaveLength(1)
    expect(store.dump().ledger.filter((e) => e.kind === 'spend')).toHaveLength(1)
    expect(await wallet.balance('alice', NOW)).toBe(29_900)
  })

  it('does not spend expired lots', async () => {
    const { wallet } = await seed()
    // Через 20 дней order-b (−350 дней) уже сгорел, живы 300 ₽ + 200 ₽.
    expect(await wallet.balance('alice', at(20))).toBe(50_000)
    expect(await wallet.spend('alice', 50_100, 'late', at(20))).toEqual({
      ok: false,
      error: 'INSUFFICIENT',
    })
  })
})

describe('expireDue', () => {
  it('writes one expire entry per lot and is idempotent', async () => {
    const { wallet, store } = setup()
    await wallet.accrue('alice', 1_000_000, 'o1', at(-400))
    await wallet.accrue('alice', 1_000_000, 'o2', at(-10))
    await wallet.spend('alice', 10_000, 'spend-1', at(-380)) // из старого лота
    const first = await wallet.expireDue(NOW)
    expect(first).toEqual({ lots: 1, kopecks: 20_000 })
    const [second, third] = await Promise.all([wallet.expireDue(NOW), wallet.expireDue(NOW)])
    expect(second).toEqual({ lots: 0, kopecks: 0 })
    expect(third).toEqual({ lots: 0, kopecks: 0 })
    const { ledger } = store.dump()
    const expired = ledger.filter((e) => e.kind === 'expire')
    expect(expired).toHaveLength(1)
    const old = ledger.find((e) => e.idempotencyKey === 'purchase:o1')!
    expect(expired[0]).toMatchObject({ amountKopecks: -20_000, relatedEntryId: old.id })
    expect(old.lotRemainingKopecks).toBe(0)
    // Исходная строка начисления не изменилась, кроме остатка.
    expect(old.amountKopecks).toBe(30_000)
    expect(await wallet.balance('alice', NOW)).toBe(30_000)
  })

  it('parallel expire runs expire each lot once', async () => {
    const { wallet, store } = setup()
    for (let i = 0; i < 5; i++) await wallet.accrue(`c${i}`, 1_000_000, `o${i}`, at(-400))
    const runs = await Promise.all([wallet.expireDue(NOW), wallet.expireDue(NOW)])
    expect(runs.reduce((s, r) => s + r.lots, 0)).toBe(5)
    expect(store.dump().ledger.filter((e) => e.kind === 'expire')).toHaveLength(5)
  })
})

describe('referrals', () => {
  const join = async (wallet: ReturnType<typeof setup>['wallet'], friend: string, code: string) =>
    wallet.attachReferral(friend, code, NOW)

  it('gives 1000 ₽ exactly once per three qualified friends', async () => {
    const { wallet, store } = setup()
    const code = await wallet.ensureReferralCode('alice', NOW)
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/)
    expect(await wallet.ensureReferralCode('alice', NOW)).toBe(code)
    for (const f of ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'])
      expect(await join(wallet, f, code.toLowerCase())).toEqual({ ok: true })

    await wallet.qualifyReferral('f1', NOW)
    // Повторный webhook первой покупки не считается вторым другом.
    expect(await wallet.qualifyReferral('f1', NOW)).toEqual({ qualified: false, rewarded: false })
    await wallet.qualifyReferral('f2', NOW)
    expect(store.dump().ledger).toHaveLength(0)
    // Параллельно: третий друг (награда), его дубль и ещё трое.
    await Promise.all(
      ['f3', 'f3', 'f4', 'f5', 'f6', 'f6'].map((f) => wallet.qualifyReferral(f, NOW)),
    )
    await wallet.qualifyReferral('f7', NOW)

    const rewards = store.dump().ledger.filter((e) => e.kind === 'referral')
    expect(rewards).toHaveLength(2)
    expect(rewards.every((r) => r.customerId === 'alice' && r.amountKopecks === 100_000)).toBe(true)
    expect(rewards.map((r) => r.idempotencyKey).sort()).toEqual([
      'referral:alice:1',
      'referral:alice:2',
    ])
    expect(rewards[0]!.expiresAt).toEqual(bonusExpiresAt(NOW))

    const summary = await wallet.summary('alice', NOW)
    expect(summary.referral).toEqual({
      code,
      qualified: 7,
      progress: { inRound: 1, remaining: 2, rewards: 2, groupSize: 3 },
    })
    expect(summary.balanceKopecks).toBe(200_000)
  })

  it('forbids self-referral, unknown codes and a second referrer', async () => {
    const { wallet, store } = setup()
    const alice = await wallet.ensureReferralCode('alice', NOW)
    const bob = await wallet.ensureReferralCode('bob', NOW)
    expect(alice).not.toBe(bob)
    expect(await join(wallet, 'alice', alice)).toEqual({ ok: false, error: 'SELF' })
    expect(await join(wallet, 'carol', 'NOPE2345')).toEqual({ ok: false, error: 'UNKNOWN_CODE' })
    expect(await join(wallet, 'carol', '../../x')).toEqual({ ok: false, error: 'UNKNOWN_CODE' })
    expect(await join(wallet, 'carol', alice)).toEqual({ ok: true })
    expect(await join(wallet, 'carol', bob)).toEqual({ ok: false, error: 'ALREADY_ATTACHED' })
    // Себя не засчитать и без привязки: квалификация без реферала — ничего.
    expect(await wallet.qualifyReferral('alice', NOW)).toEqual({
      qualified: false,
      rewarded: false,
    })
    expect(store.dump().referrals).toHaveLength(1)
  })
})

describe('summary', () => {
  it('shows balance, expiring soon and newest-first history capped at 50', async () => {
    const { wallet } = setup()
    // 60 начислений: самое старое (−350 дней) сгорит через 15 дней.
    for (let i = 0; i < 60; i++) await wallet.accrue('alice', 100_000, `o${i}`, at(-350 + i))
    const s = await wallet.summary('alice', NOW)
    expect(s.balanceKopecks).toBe(60 * 3_000)
    expect(s.history).toHaveLength(50)
    expect(s.history[0]!.at.getTime()).toBeGreaterThan(s.history[49]!.at.getTime())
    expect(s.history[0]).toMatchObject({ kind: 'purchase', amountKopecks: 3_000 })
    expect(s.expiring?.earliest).toEqual(bonusExpiresAt(at(-350)))
    // В ближайшие 30 дней сгорают лоты, начисленные с −350 по −335 дня: 16 штук.
    expect(s.expiring?.amountKopecks).toBe(16 * 3_000)
    expect(s.certificates).toEqual([])
    expect(s.referral.qualified).toBe(0)
  })
})
