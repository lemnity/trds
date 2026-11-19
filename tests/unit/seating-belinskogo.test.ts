import { describe, expect, it } from 'vitest'

import {
  HALL_PLAN_OPTIONS,
  applySeatLayout,
  belinskogoPlan,
  blockSlots,
  getSeatingPlan,
  layoutOfPricing,
  parseSeatPricing,
  seatCategoryColor,
  seatsOf,
} from '../../src/modules/seating'

const slots = (row: number, section: 'left' | 'right') =>
  blockSlots(belinskogoPlan.rows[row - 1]!.blocks.find((b) => b.section === section)!).map((s) =>
    s ? s.number : null,
  )

describe('Белинского seating plan', () => {
  it('is registered as a seat plan', () => {
    expect(getSeatingPlan('belinskogo')).toBe(belinskogoPlan)
    expect(HALL_PLAN_OPTIONS.map((o) => o.value)).toContain('belinskogo')
  })

  it('has 68 seats with unique ids', () => {
    const seats = seatsOf(belinskogoPlan)
    expect(seats).toHaveLength(68)
    expect(new Set(seats.map((s) => s.id)).size).toBe(68)
  })

  it('keeps "no seat" positions as gaps so rows stay aligned', () => {
    expect(slots(1, 'left')).toEqual([1, 2, 3, 4, null, null])
    expect(slots(1, 'right')).toEqual([7, 8, 9, 10, 11])
    expect(slots(2, 'left')).toEqual([1, 2, 3, 4, 5, 6])
    expect(slots(7, 'left')).toEqual([1, 2, null, null, null, null])
    expect(slots(7, 'right')).toEqual([null, null, null, 10, 11])
  })

  it('prices by rows like the theatre scheme, with its colours', () => {
    const categoryOf = (id: string) => seatsOf(belinskogoPlan).find((s) => s.id === id)!.categoryId
    expect(categoryOf('r2-s6')).toBe('cat-1')
    expect(categoryOf('r4-s7')).toBe('cat-2')
    expect(categoryOf('r6-s1')).toBe('cat-3')
    expect(categoryOf('r7-s11')).toBe('cat-4')
    expect(seatCategoryColor(belinskogoPlan, 'cat-1')).toBe('#e30613')
  })

  it('renaming a category in the admin keeps the scheme colour', () => {
    const plan = applySeatLayout(belinskogoPlan, {
      categories: [{ id: 'cat-1', title: 'Первые ряды' }],
    })
    expect(plan.categories[0]).toEqual({ id: 'cat-1', title: 'Первые ряды', color: '#e30613' })
  })

  it('a zone colour chosen in the admin reaches the site plan', () => {
    const parsed = parseSeatPricing({
      zones: [{ categoryId: 'cat-2', title: 'Ряды 3–4', priceKopecks: 1, color: '#FF8800' }],
      seats: {},
    })
    const plan = applySeatLayout(belinskogoPlan, layoutOfPricing(parsed.ok ? parsed.pricing : null))
    expect(seatCategoryColor(plan, 'cat-2')).toBe('#ff8800')
    expect(seatCategoryColor(plan, 'cat-1')).toBe('#e30613')
  })
})
