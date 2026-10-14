import { describe, expect, it } from 'vitest'

import { formatRub } from '../../src/lib/money'

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
