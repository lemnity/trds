import { describe, expect, it } from 'vitest'

import {
  domKulturyPlan,
  getSeatingPlan,
  quoteSeats,
  seatPlace,
  seatsOf,
} from '../../src/modules/seating'
import { seatLabel } from '../../src/modules/tickets/performances'

const seats = seatsOf(domKulturyPlan)

describe('Бар «Дом Культуры» floor plan', () => {
  it('replaces the temporary row copy with the bar floor plan (v2)', () => {
    expect(getSeatingPlan('dom-kultury')).toBe(domKulturyPlan)
    expect(domKulturyPlan.version).toBe(2)
    expect(domKulturyPlan.venueId).toBe('dk')
    // Номера до 28, столов 23 и 24 на схеме театра нет.
    expect(domKulturyPlan.floor?.tables).toHaveLength(26)
  })

  it('has 106 seats with unique ids, each placed on the floor', () => {
    expect(seats).toHaveLength(106)
    expect(new Set(seats.map((s) => s.id)).size).toBe(106)
    for (const s of seats) {
      expect(s.x, s.id).toBeGreaterThan(0)
      expect(s.y, s.id).toBeGreaterThan(0)
      expect(s.x!).toBeLessThan(domKulturyPlan.floor!.width)
      expect(s.y!).toBeLessThan(domKulturyPlan.floor!.height)
    }
  })

  it('closes the grey seats of the theatre scheme by default', () => {
    const closed = new Set(domKulturyPlan.defaultClosedSeatIds)
    expect(closed.size).toBe(seats.length - 41)
    expect(closed.has('t25-s1')).toBe(true)
    expect(closed.has('t8-s1')).toBe(false)
    expect(closed.has('b1-s4')).toBe(false)
    for (const id of closed)
      expect(
        seats.some((s) => s.id === id),
        id,
      ).toBe(true)
  })

  it('labels seats by table and bar', () => {
    const t8 = seats.find((s) => s.id === 't8-s3')!
    expect(seatPlace(domKulturyPlan, t8)).toBe('Стол 8, место 3')
    expect(
      seatPlace(
        domKulturyPlan,
        seats.find((s) => s.id === 'b2-s5')!,
      ),
    ).toBe('Стойка у сцены, место 5')
    expect(seatLabel('t8-s3')).toBe('Стол 8, место 3')
    expect(seatLabel('b1-s2')).toBe('Барная стойка, место 2')
    expect(seatLabel('r3-s12')).toBe('Ряд 3, место 12')
  })

  it('sells seats one by one by their category', () => {
    const result = quoteSeats(domKulturyPlan, { 'cat-1': 150_000, 'cat-4': 200_000 }, new Set(), [
      'b1-s4',
      't7-s1',
    ])
    expect(result.ok && result.quote.totalKopecks).toBe(350_000)
  })
})
