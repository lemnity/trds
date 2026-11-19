import { describe, expect, it } from 'vitest'

import { formatRub, parseRub, rubInput } from '../../src/lib/money'

// Intl ставит неразрывные пробелы — сравниваем, нормализуя их.
const plain = (s: string) => s.replace(/[  ]/g, ' ')

describe('formatRub', () => {
  it('formats whole rubles without kopecks', () => {
    expect(plain(formatRub(100_000))).toBe('1 000 ₽')
  })

  it('shows kopecks only when present', () => {
    expect(plain(formatRub(150_050))).toBe('1 500,50 ₽')
  })

  it('rejects non-integer amounts', () => {
    expect(() => formatRub(10.5)).toThrow(RangeError)
  })
})

describe('parseRub', () => {
  it('parses rubles and kopecks into integer kopecks', () => {
    expect(parseRub('1500')).toBe(150_000)
    expect(parseRub('1 500,50')).toBe(150_050)
    expect(parseRub('1500.5')).toBe(150_050)
    expect(parseRub('0')).toBe(0)
    expect(parseRub('19.99')).toBe(1999)
  })

  it('treats empty input as no price', () => {
    expect(parseRub('')).toBeNull()
    expect(parseRub('  ')).toBeNull()
  })

  it('rejects garbage', () => {
    expect(parseRub('abc')).toBeUndefined()
    expect(parseRub('-5')).toBeUndefined()
    expect(parseRub('1.234')).toBeUndefined()
    expect(parseRub('1,2,3')).toBeUndefined()
  })
})

describe('rubInput', () => {
  it('formats kopecks for the input', () => {
    expect(rubInput(150_000)).toBe('1500')
    expect(rubInput(150_050)).toBe('1500.5')
    expect(rubInput(null)).toBe('')
  })

  it('round-trips with parseRub', () => {
    for (const k of [0, 1, 99, 100, 150_050]) expect(parseRub(rubInput(k))).toBe(k)
  })
})
