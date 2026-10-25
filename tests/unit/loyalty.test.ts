import { randomInt } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  CERTIFICATE_ALPHABET,
  accrualFor,
  applyBonus,
  availableBalance,
  bonusExpiresAt,
  expiringSoon,
  generateCertificateCode,
  maxBonusSpend,
  parseCertificateCode,
  planSpend,
  referralProgress,
  referralRemainingText,
} from '../../src/modules/loyalty'

const day = (iso: string) => new Date(`${iso}T12:00:00Z`)

describe('bonus rules', () => {
  it('accrues 3% of the cash part, rounded down to a ruble', () => {
    expect(accrualFor(300_000)).toBe(9_000)
    expect(accrualFor(333_300)).toBe(9_900) // 99,99 ₽ → 99 ₽
    expect(accrualFor(0)).toBe(0)
  })

  it('caps spending at 30% of tickets and at the balance', () => {
    expect(maxBonusSpend(300_000, 1_000_000)).toBe(90_000)
    expect(maxBonusSpend(300_000, 50_050)).toBe(50_000)
  })

  it('clamps the requested amount and accrues only on cash for tickets', () => {
    const r = applyBonus({
      ticketsKopecks: 300_000,
      feeKopecks: 20_000,
      balanceKopecks: 1_000_000,
      requestedKopecks: 999_999_999,
    })
    expect(r).toEqual({
      spentKopecks: 90_000,
      maxKopecks: 90_000,
      cashKopecks: 230_000,
      accrualKopecks: 6_300,
    })
  })

  it('ignores negative or fractional requests', () => {
    const base = { ticketsKopecks: 300_000, feeKopecks: 0, balanceKopecks: 100_000 }
    expect(applyBonus({ ...base, requestedKopecks: -500 }).spentKopecks).toBe(0)
    expect(applyBonus({ ...base, requestedKopecks: 1.5 }).spentKopecks).toBe(0)
    expect(applyBonus({ ...base, requestedKopecks: 10_050 }).spentKopecks).toBe(10_000)
  })

  it('rejects non-integer money', () => {
    expect(() => accrualFor(10.5)).toThrow(RangeError)
  })

  it('expires each accrual after a year', () => {
    expect(bonusExpiresAt(day('2026-10-25')).toISOString()).toBe('2027-10-25T12:00:00.000Z')
  })
})

describe('bonus lots', () => {
  const now = day('2026-10-25')
  const lots = [
    { id: 'b', remainingKopecks: 50_000, expiresAt: day('2027-05-01') },
    { id: 'a', remainingKopecks: 30_000, expiresAt: day('2026-11-10') },
    { id: 'old', remainingKopecks: 99_000, expiresAt: day('2026-10-01') },
  ]

  it('counts only live lots', () => {
    expect(availableBalance(lots, now)).toBe(80_000)
  })

  it('spends the soonest-expiring first and refuses overdraft', () => {
    expect(planSpend(lots, 40_000, now)).toEqual([
      { lotId: 'a', kopecks: 30_000 },
      { lotId: 'b', kopecks: 10_000 },
    ])
    expect(planSpend(lots, 80_001, now)).toBeNull()
  })

  it('reports what expires within 30 days', () => {
    expect(expiringSoon(lots, now)).toEqual({ amountKopecks: 30_000, earliest: day('2026-11-10') })
    expect(expiringSoon([lots[0]!], now)).toBeNull()
  })
})

describe('referral «Приведи 3 друга»', () => {
  it('tracks the round and rewards', () => {
    expect(referralProgress(0)).toMatchObject({ inRound: 0, remaining: 3, rewards: 0 })
    expect(referralProgress(1)).toMatchObject({ inRound: 1, remaining: 2, rewards: 0 })
    expect(referralProgress(3)).toMatchObject({ inRound: 0, remaining: 3, rewards: 1 })
    expect(referralProgress(7)).toMatchObject({ inRound: 1, remaining: 2, rewards: 2 })
  })

  it('pluralizes the indicator', () => {
    expect(referralRemainingText(2)).toBe('Осталось ещё 2 друга')
    expect(referralRemainingText(1)).toBe('Остался ещё 1 друг')
    expect(referralRemainingText(5)).toBe('Осталось ещё 5 друзей')
  })
})

describe('certificate codes', () => {
  it('generates well-formed codes that pass the checksum', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCertificateCode(randomInt)
      expect(code).toMatch(/^TRDS-[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/)
      expect(parseCertificateCode(code)).toMatchObject({ ok: true, code })
    }
  })

  it('accepts sloppy input', () => {
    const code = generateCertificateCode(randomInt)
    const sloppy = ` ${code.slice(5).toLowerCase().replace(/-/g, ' ')} `
    expect(parseCertificateCode(sloppy)).toMatchObject({ ok: true, code })
  })

  it('catches every single-character typo', () => {
    const code = generateCertificateCode(randomInt)
    const raw = code.slice(5).replace(/-/g, '')
    for (let pos = 0; pos < raw.length; pos++) {
      for (const c of CERTIFICATE_ALPHABET) {
        if (c === raw[pos]) continue
        const typo = raw.slice(0, pos) + c + raw.slice(pos + 1)
        expect(parseCertificateCode(typo)).toEqual({ ok: false, error: 'CHECKSUM' })
      }
    }
  })

  it('rejects ambiguous characters and wrong length', () => {
    expect(parseCertificateCode('TRDS-0000-1111-OOOO')).toEqual({ ok: false, error: 'FORMAT' })
    expect(parseCertificateCode('ABC')).toEqual({ ok: false, error: 'FORMAT' })
  })
})
