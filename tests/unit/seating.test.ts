import { describe, expect, it } from 'vitest'

import { domAkteraPlan, getSeatingPlan, quoteSeats, seatsOf } from '../../src/modules/seating'

const prices = {
  'cat-1': 250_000,
  'cat-2': 220_000,
  'cat-3': 200_000,
  'cat-4': 180_000,
  'cat-5': 150_000,
  'cat-6': 120_000,
  'cat-7': 100_000,
}

describe('Дом актёра seating plan', () => {
  const seats = seatsOf(domAkteraPlan)

  it('has 136 seats: rows 1–7 with 2+9+2, rows 8–12 with 9', () => {
    expect(seats).toHaveLength(136)
    for (const row of domAkteraPlan.rows) {
      const count = row.blocks.reduce((sum, b) => sum + b.seats.length, 0)
      expect(count, `row ${row.number}`).toBe(row.number <= 7 ? 13 : 9)
    }
  })

  it('uses unique seat ids', () => {
    expect(new Set(seats.map((s) => s.id)).size).toBe(seats.length)
  })

  it('assigns price categories by rows as on the theatre scheme', () => {
    const categoryOfRow = (row: number) =>
      new Set(seats.filter((s) => s.row === row).map((s) => s.categoryId))
    expect(categoryOfRow(1)).toEqual(new Set(['cat-1']))
    expect(categoryOfRow(2)).toEqual(new Set(['cat-2']))
    expect(categoryOfRow(4)).toEqual(new Set(['cat-3']))
    expect(categoryOfRow(7)).toEqual(new Set(['cat-4']))
    expect(categoryOfRow(9)).toEqual(new Set(['cat-5']))
    expect(categoryOfRow(11)).toEqual(new Set(['cat-6']))
    expect(categoryOfRow(12)).toEqual(new Set(['cat-7']))
  })
})

describe('Дом Культуры seating plan', () => {
  it('uses the same 136-seat layout as provided by the theatre', () => {
    const plan = getSeatingPlan('dom-kultury')
    expect(plan?.venueId).toBe('dk')
    expect(seatsOf(plan!).map((s) => [s.id, s.categoryId])).toEqual(
      seatsOf(domAkteraPlan).map((s) => [s.id, s.categoryId]),
    )
  })
})

describe('quoteSeats', () => {
  const unavailable = new Set(['r1-s5'])

  it('prices each seat by its category and groups lines by category', () => {
    const result = quoteSeats(domAkteraPlan, prices, unavailable, ['r1-s3', 'r1-s4', 'r12-s9'])
    expect(result).toEqual({
      ok: true,
      quote: {
        seats: [
          {
            id: 'r1-s3',
            row: 1,
            number: 3,
            section: 'center',
            categoryId: 'cat-1',
            priceKopecks: 250_000,
          },
          {
            id: 'r1-s4',
            row: 1,
            number: 4,
            section: 'center',
            categoryId: 'cat-1',
            priceKopecks: 250_000,
          },
          {
            id: 'r12-s9',
            row: 12,
            number: 9,
            section: 'center',
            categoryId: 'cat-7',
            priceKopecks: 100_000,
          },
        ],
        lines: [
          {
            categoryId: 'cat-1',
            title: 'Категория 1',
            unitPriceKopecks: 250_000,
            quantity: 2,
            totalKopecks: 500_000,
          },
          {
            categoryId: 'cat-7',
            title: 'Категория 7',
            unitPriceKopecks: 100_000,
            quantity: 1,
            totalKopecks: 100_000,
          },
        ],
        ticketCount: 3,
        totalKopecks: 600_000,
      },
    })
  })

  it('reports the section of side seats', () => {
    const result = quoteSeats(domAkteraPlan, prices, unavailable, ['r3-s1', 'r3-s13'])
    expect(result.ok && result.quote.seats.map((s) => s.section)).toEqual(['left', 'right'])
  })

  it('rejects an empty selection', () => {
    expect(quoteSeats(domAkteraPlan, prices, unavailable, [])).toEqual({
      ok: false,
      error: 'EMPTY_ORDER',
    })
  })

  it('rejects unknown, duplicate and unavailable seats', () => {
    expect(quoteSeats(domAkteraPlan, prices, unavailable, ['r99-s1'])).toEqual({
      ok: false,
      error: 'UNKNOWN_SEAT',
    })
    expect(quoteSeats(domAkteraPlan, prices, unavailable, ['r1-s3', 'r1-s3'])).toEqual({
      ok: false,
      error: 'DUPLICATE_SEAT',
    })
    expect(quoteSeats(domAkteraPlan, prices, unavailable, ['r1-s5'])).toEqual({
      ok: false,
      error: 'SEAT_UNAVAILABLE',
    })
  })

  it('does not sell seats of a category without a price', () => {
    const withoutCat7 = Object.fromEntries(Object.entries(prices).filter(([k]) => k !== 'cat-7'))
    expect(quoteSeats(domAkteraPlan, withoutCat7, unavailable, ['r12-s9'])).toEqual({
      ok: false,
      error: 'PRICE_NOT_SET',
    })
  })

  it('limits seats per order', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `r9-s${i < 9 ? i + 1 : 0}`)
      .slice(0, 9)
      .concat(['r10-s1', 'r10-s2'])
    expect(quoteSeats(domAkteraPlan, prices, unavailable, eleven)).toEqual({
      ok: false,
      error: 'TOO_MANY_TICKETS',
    })
  })
})
