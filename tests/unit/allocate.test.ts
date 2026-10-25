import { describe, expect, it } from 'vitest'

import { allocate } from '../../src/modules/checkout'

/** Разложение бонусов заказа по позициям и билетам — так же, как это делает `@/modules/orders`. */
const applyBonusAndAllocate = (
  lines: { unit: number; qty: number }[],
  bonusKopecks: number,
  feePerTicketKopecks: number,
) => {
  const grosses = lines.map((l) => l.unit * l.qty)
  const shares = allocate(bonusKopecks, grosses)
  const gross = grosses.reduce((a, b) => a + b, 0)
  const tickets = lines.reduce((a, l) => a + l.qty, 0)
  return {
    cash: gross - bonusKopecks + feePerTicketKopecks * tickets,
    items: lines.map((l, i) => ({
      gross: grosses[i]!,
      bonus: shares[i]!,
      cash: grosses[i]! - shares[i]!,
      tickets: allocate(shares[i]!, Array(l.qty).fill(l.unit)),
    })),
  }
}

describe('allocate (largest remainder)', () => {
  it('splits exactly, remainder to the largest fractional parts', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(allocate(101, [1, 1, 1])).toEqual([34, 34, 33])
    expect(allocate(1000, [1, 2, 3])).toEqual([167, 333, 500])
    // 10 × 1/3 = 3.33…, 10 × 2/3 = 6.66… → лишняя копейка второй позиции.
    expect(allocate(10, [1, 2])).toEqual([3, 7])
  })

  it('ties go to the lower index; result is deterministic', () => {
    expect(allocate(1, [5, 5, 5, 5])).toEqual([1, 0, 0, 0])
    expect(allocate(2, [5, 5, 5, 5])).toEqual([1, 1, 0, 0])
    expect(allocate(7, [3, 3, 3])).toEqual(allocate(7, [3, 3, 3]))
  })

  it('zero total, zero weights and invalid input', () => {
    expect(allocate(0, [1, 2])).toEqual([0, 0])
    expect(allocate(0, [])).toEqual([])
    expect(allocate(5, [0, 3, 0])).toEqual([0, 5, 0])
    expect(() => allocate(5, [0, 0])).toThrow(RangeError)
    expect(() => allocate(5, [])).toThrow(RangeError)
    expect(() => allocate(-1, [1])).toThrow(RangeError)
    expect(() => allocate(1.5, [1])).toThrow(RangeError)
    expect(() => allocate(10, [1, 0.5])).toThrow(RangeError)
    expect(() => allocate(10, [1, -1])).toThrow(RangeError)
  })

  it('keeps precision where total × weight exceeds 2^53', () => {
    const big = 2 ** 40
    const shares = allocate(big + 1, [big, big, 1])
    expect(shares.reduce((a, b) => a + b, 0)).toBe(big + 1)
    expect(shares).toEqual([549_755_813_888, 549_755_813_888, 1])
  })

  it('property: sum is exact, shares are integers and never exceed their weight', () => {
    // Детерминированный генератор — тест воспроизводим.
    let seed = 42
    const next = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31
      return seed % max
    }
    for (let round = 0; round < 500; round++) {
      const weights = Array.from({ length: 1 + next(8) }, () => next(500_000))
      const sum = weights.reduce((a, b) => a + b, 0)
      if (sum === 0) continue
      const total = next(sum + 1)
      const shares = allocate(total, weights)
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total)
      shares.forEach((s, i) => {
        expect(Number.isSafeInteger(s) && s >= 0).toBe(true)
        expect(s).toBeLessThanOrEqual(weights[i]!)
        // Отклонение от точной доли меньше копейки.
        expect(Math.abs(s - (total * weights[i]!) / sum)).toBeLessThan(1)
      })
    }
  })

  it('bonus scenario: order → items → tickets add up to the kopeck', () => {
    // 2 × 1500 ₽ + 1 × 990,50 ₽, сбор 200 ₽ за билет, бонусами 1 000 ₽ (≤ 30% и целые рубли).
    const result = applyBonusAndAllocate(
      [
        { unit: 150_000, qty: 2 },
        { unit: 99_050, qty: 1 },
      ],
      100_000,
      20_000,
    )
    expect(result.items).toEqual([
      // 100 000 × 300 000 / 399 050 = 75 178,55… → 75 179 (больший остаток получает копейку).
      { gross: 300_000, bonus: 75_179, cash: 224_821, tickets: [37_590, 37_589] },
      // 100 000 × 99 050 / 399 050 = 24 821,45… → 24 821.
      { gross: 99_050, bonus: 24_821, cash: 74_229, tickets: [24_821] },
    ])
    expect(result.cash).toBe(399_050 - 100_000 + 60_000)
    const ticketBonus = result.items.flatMap((i) => i.tickets)
    expect(ticketBonus.reduce((a, b) => a + b, 0)).toBe(100_000)
  })
})
