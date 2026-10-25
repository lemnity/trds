import { describe, expect, it } from 'vitest'

import {
  bonusRublesText,
  bonusWord,
  loginHrefFor,
  parseBonusRubles,
  parseDemoBalance,
} from '../../src/modules/checkout'
import { applyBonus } from '../../src/modules/loyalty'

describe('parseBonusRubles', () => {
  it('treats empty input as zero', () => {
    expect(parseBonusRubles('')).toEqual({ ok: true, kopecks: 0 })
    expect(parseBonusRubles('   ')).toEqual({ ok: true, kopecks: 0 })
  })

  it('converts whole rubles to integer kopecks', () => {
    expect(parseBonusRubles('300')).toEqual({ ok: true, kopecks: 30_000 })
    expect(parseBonusRubles('007')).toEqual({ ok: true, kopecks: 700 })
    expect(parseBonusRubles('0')).toEqual({ ok: true, kopecks: 0 })
  })

  it('accepts thousand separators, including non-breaking spaces', () => {
    expect(parseBonusRubles('1 500')).toEqual({ ok: true, kopecks: 150_000 })
    expect(parseBonusRubles('1 500')).toEqual({ ok: true, kopecks: 150_000 })
    expect(parseBonusRubles('1 500')).toEqual({ ok: true, kopecks: 150_000 })
  })

  it('rejects fractions, signs, exponents and letters instead of guessing', () => {
    for (const text of ['10.5', '10,5', '-100', '+100', '1e3', '0x10', 'abc', '100₽', 'Infinity']) {
      expect(parseBonusRubles(text)).toEqual({ ok: false })
    }
  })

  it('rejects absurdly long numbers so kopecks stay a safe integer', () => {
    expect(parseBonusRubles('999999999')).toEqual({ ok: true, kopecks: 99_999_999_900 })
    expect(parseBonusRubles('1000000000')).toEqual({ ok: false })
    expect(parseBonusRubles('9'.repeat(30))).toEqual({ ok: false })
  })
})

describe('bonusRublesText', () => {
  it('formats kopecks as whole rubles for the input', () => {
    expect(bonusRublesText(60_000)).toBe('600')
    expect(bonusRublesText(0)).toBe('0')
    expect(bonusRublesText(12_345)).toBe('123')
  })

  it('round-trips through the parser', () => {
    expect(parseBonusRubles(bonusRublesText(150_000))).toEqual({ ok: true, kopecks: 150_000 })
  })
})

describe('parseDemoBalance', () => {
  it('reads a valid demo balance', () => {
    expect(parseDemoBalance('{"balanceKopecks":125000}')).toBe(125_000)
  })

  it('falls back to zero for missing, broken or unsafe values', () => {
    for (const raw of [
      null,
      '',
      'not json',
      'null',
      '42',
      '{}',
      '{"balanceKopecks":"1000"}',
      '{"balanceKopecks":-100}',
      '{"balanceKopecks":10.5}',
      '{"balanceKopecks":1e300}',
    ]) {
      expect(parseDemoBalance(raw)).toBe(0)
    }
  })
})

describe('loginHrefFor', () => {
  it('returns to the same checkout with its selection', () => {
    expect(loginHrefFor('/checkout/p1', 'seats=a-1-2,a-1-3')).toBe(
      '/login?next=%2Fcheckout%2Fp1%3Fseats%3Da-1-2%2Ca-1-3',
    )
    expect(loginHrefFor('/checkout/p1', '?std=2')).toBe('/login?next=%2Fcheckout%2Fp1%3Fstd%3D2')
    expect(loginHrefFor('/checkout/p1', '')).toBe('/login?next=%2Fcheckout%2Fp1')
  })

  it('never builds an off-site return path', () => {
    expect(loginHrefFor('//evil.example/x', '')).toBe('/login')
    expect(loginHrefFor('https://evil.example', '')).toBe('/login')
  })

  it('produces a next value accepted as a relative path', () => {
    const next = new URLSearchParams(loginHrefFor('/checkout/p1', 'std=2').split('?')[1]).get(
      'next',
    )
    expect(next).toBe('/checkout/p1?std=2')
  })
})

describe('bonusWord', () => {
  it('declines «бонус» by count', () => {
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(bonusWord)).toEqual([
      'бонусов',
      'бонус',
      'бонуса',
      'бонуса',
      'бонусов',
      'бонусов',
      'бонусов',
      'бонусов',
      'бонус',
      'бонуса',
      'бонусов',
      'бонус',
      'бонусов',
    ])
  })
})

describe('checkout bonus flow (input → applyBonus)', () => {
  const tickets = 200_000 // 2 000 ₽ билетов
  const fee = 40_000 // сбор 2 × 200 ₽, не входит в базу 30%

  const apply = (text: string, balance: number) => {
    const input = parseBonusRubles(text)
    return applyBonus({
      ticketsKopecks: tickets,
      feeKopecks: fee,
      balanceKopecks: balance,
      requestedKopecks: input.ok ? input.kopecks : 0,
    })
  }

  it('clamps a typed amount above 30% of tickets', () => {
    const r = apply('5000', 1_000_000)
    expect(r.maxKopecks).toBe(60_000)
    expect(r.spentKopecks).toBe(60_000)
    expect(r.cashKopecks).toBe(tickets - 60_000 + fee)
    expect(r.accrualKopecks).toBe(4_200) // 3% от 1 400 ₽
  })

  it('treats invalid input as no spend', () => {
    const r = apply('10,5', 1_000_000)
    expect(r.spentKopecks).toBe(0)
    expect(r.cashKopecks).toBe(tickets + fee)
    expect(r.accrualKopecks).toBe(6_000)
  })

  it('a zero balance spends nothing whatever is typed', () => {
    expect(apply('300', 0).spentKopecks).toBe(0)
  })
})
