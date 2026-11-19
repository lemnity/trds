import { describe, expect, it } from 'vitest'

import {
  SEAT_PRICING_ERRORS,
  applySeatLayout,
  completePricing,
  domAkteraPlan,
  layoutOf,
  layoutOfPricing,
  parseSeatPricing,
  pricesOf,
  pricingSummary,
  quoteSeats,
  seatsOf,
  validateSeatPricing,
} from '../../src/modules/seating'
import type { SeatPricingError } from '../../src/modules/seating/pricing'

describe('applySeatLayout', () => {
  it('returns the plan as is without a layout', () => {
    expect(applySeatLayout(domAkteraPlan, null)).toBe(domAkteraPlan)
    expect(applySeatLayout(domAkteraPlan, { categories: [], seatCategories: {} })).toBe(
      domAkteraPlan,
    )
  })

  it('moves seats to custom zones and keeps plan categories still in use', () => {
    const plan = applySeatLayout(domAkteraPlan, {
      categories: [{ id: 'cat-8', title: 'VIP' }],
      seatCategories: { 'r1-s1': 'cat-8', 'r1-s2': 'cat-8' },
    })
    const seat = seatsOf(plan).find((s) => s.id === 'r1-s1')!
    expect(seat.categoryId).toBe('cat-8')
    expect(plan.categories[0]).toEqual({ id: 'cat-8', title: 'VIP' })
    expect(plan.categories.map((c) => c.id)).toContain('cat-1')
    expect(seatsOf(plan)).toHaveLength(136)
  })

  it('drops plan categories without seats and renames zones', () => {
    const all = Object.fromEntries(seatsOf(domAkteraPlan).map((s) => [s.id, 'cat-1']))
    const plan = applySeatLayout(domAkteraPlan, {
      categories: [{ id: 'cat-1', title: 'Партер' }],
      seatCategories: all,
    })
    expect(plan.categories).toEqual([{ id: 'cat-1', title: 'Партер' }])
  })

  it('ignores overrides to unknown zones', () => {
    const plan = applySeatLayout(domAkteraPlan, { seatCategories: { 'r1-s1': 'nope' } })
    expect(seatsOf(plan).find((s) => s.id === 'r1-s1')!.categoryId).toBe('cat-1')
  })

  it('prices seats by their layout zone', () => {
    const plan = applySeatLayout(domAkteraPlan, {
      categories: [{ id: 'cat-8', title: 'VIP' }],
      seatCategories: { 'r12-s1': 'cat-8' },
    })
    const result = quoteSeats(plan, { 'cat-8': 500_000 }, new Set(), ['r12-s1'])
    expect(result.ok && result.quote.totalKopecks).toBe(500_000)
    expect(result.ok && result.quote.lines[0]!.title).toBe('VIP')
  })

  it('layoutOf round-trips through applySeatLayout', () => {
    const plan = applySeatLayout(domAkteraPlan, {
      categories: [{ id: 'cat-9', title: 'Балкон' }],
      seatCategories: { 'r5-s5': 'cat-9' },
    })
    expect(applySeatLayout(domAkteraPlan, layoutOf(plan))).toEqual(plan)
  })
})

describe('seat pricing (CMS JSON)', () => {
  const pricing = {
    zones: [
      { categoryId: 'cat-1', title: 'Партер', priceKopecks: 150_000 },
      { categoryId: 'cat-2', title: 'Галёрка', priceKopecks: null },
    ],
    seats: { 'r1-s1': 'cat-1', 'r12-s9': 'cat-2' },
  }

  it('parses valid pricing and empty value', () => {
    expect(parseSeatPricing(null)).toEqual({ ok: true, pricing: null })
    expect(parseSeatPricing(pricing)).toEqual({ ok: true, pricing })
  })

  it.each([
    [{ zones: 'x' }, 'NOT_AN_OBJECT'],
    [{ zones: [{ categoryId: 'vip', title: 'VIP', priceKopecks: 1 }] }, 'BAD_ZONE'],
    [{ zones: [{ categoryId: 'cat-1', title: ' ', priceKopecks: 1 }] }, 'EMPTY_TITLE'],
    [{ zones: [{ categoryId: 'cat-1', title: 'A', priceKopecks: 1.5 }] }, 'BAD_PRICE'],
    [{ zones: [{ categoryId: 'cat-1', title: 'A', priceKopecks: -1 }] }, 'BAD_PRICE'],
    [
      {
        zones: [
          { categoryId: 'cat-1', title: 'A', priceKopecks: 1 },
          { categoryId: 'cat-1', title: 'B', priceKopecks: 1 },
        ],
      },
      'DUPLICATE_ZONE',
    ],
    [{ zones: [], seats: { 'r1-s1': 'cat-3' } }, 'BAD_SEAT_ZONE'],
  ])('rejects %j', (value, error) => {
    expect(parseSeatPricing(value)).toEqual({ ok: false, error })
    expect(validateSeatPricing(value)).toBe(SEAT_PRICING_ERRORS[error as SeatPricingError])
  })

  it('sells only priced zones', () => {
    expect(pricesOf(pricing)).toEqual({ 'cat-1': 150_000 })
  })

  it('completes pricing with plan categories and every seat', () => {
    const full = completePricing(domAkteraPlan, pricing)
    expect(Object.keys(full.seats)).toHaveLength(136)
    expect(full.seats['r12-s9']).toBe('cat-2')
    expect(full.zones.slice(0, 2)).toEqual(pricing.zones)
    expect(full.zones.find((z) => z.categoryId === 'cat-7')).toEqual({
      categoryId: 'cat-7',
      title: 'Категория 7',
      priceKopecks: null,
    })
  })

  it('summarises seats on sale and revenue', () => {
    const all = Object.fromEntries(seatsOf(domAkteraPlan).map((s) => [s.id, 'cat-1']))
    const summary = pricingSummary(
      domAkteraPlan,
      { zones: [{ categoryId: 'cat-1', title: 'Все', priceKopecks: 100_000 }], seats: all },
      ['r1-s1'],
    )
    expect(summary.onSale).toBe(135)
    expect(summary.closed).toBe(1)
    expect(summary.revenueKopecks).toBe(135 * 100_000)
  })

  it('counts closed seats per zone', () => {
    const all = Object.fromEntries(seatsOf(domAkteraPlan).map((s) => [s.id, 'cat-1']))
    const summary = pricingSummary(
      domAkteraPlan,
      { zones: [{ categoryId: 'cat-1', title: 'Все', priceKopecks: 100_000 }], seats: all },
      ['r1-s1', 'r1-s2'],
    )
    expect(summary.zones[0]).toMatchObject({ seats: 134, closed: 2 })
  })

  it('layout of pricing drives the performance plan', () => {
    const plan = applySeatLayout(domAkteraPlan, layoutOfPricing(pricing))
    expect(seatsOf(plan).find((s) => s.id === 'r12-s9')!.categoryId).toBe('cat-2')
    expect(plan.categories[0]).toEqual({ id: 'cat-1', title: 'Партер' })
  })
})
