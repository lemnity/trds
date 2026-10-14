import { describe, expect, it } from 'vitest'

import { demoShowsData, formatAge, formatDuration } from '../../src/modules/shows'

const { shows, venues, performances } = demoShowsData

describe('demo shows data', () => {
  it('references only existing shows and venues', () => {
    const slugs = new Set(shows.map((s) => s.slug))
    const venueIds = new Set(venues.map((v) => v.id))
    for (const p of performances) {
      expect(slugs.has(p.showSlug), p.id).toBe(true)
      expect(venueIds.has(p.venueId), p.id).toBe(true)
    }
  })

  it('uses unique ids and slugs', () => {
    expect(new Set(performances.map((p) => p.id)).size).toBe(performances.length)
    expect(new Set(shows.map((s) => s.slug)).size).toBe(shows.length)
  })

  it('stores prices as integer kopecks and dates with the theatre offset', () => {
    for (const p of performances) {
      expect(p.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+05:00$/)
      for (const t of p.ticketTypes) {
        expect(Number.isSafeInteger(t.priceKopecks)).toBe(true)
        expect(Number.isSafeInteger(t.capacity) && t.capacity > 0).toBe(true)
      }
    }
  })
})

describe('placeholder prices', () => {
  it('opens November seat sales of «В бананово-лимонном Сингапуре» with flagged placeholder prices', () => {
    const november = performances.filter(
      (p) => p.showSlug === 'concertsp' && p.startsAt.startsWith('2026-11'),
    )
    expect(november.length).toBeGreaterThan(0)
    for (const p of november) {
      expect(p.seating?.planId).toBe('dom-kultury')
      expect(Object.keys(p.seating?.pricesKopecks ?? {})).toHaveLength(7)
      // Цены не утверждены театром — обязаны быть помечены как заглушка.
      expect(p.seating?.pricesPlaceholder).toBe(true)
    }
  })

  it('puts every show at the bar «Дом Культуры» on its seating plan', () => {
    for (const p of performances.filter((x) => x.venueId === 'dk')) {
      expect(p.seating?.planId, p.id).toBe('dom-kultury')
    }
  })

  it('keeps theatre-confirmed prices unflagged', () => {
    const poets = performances.filter((p) => p.showSlug === 'three-poets')
    expect(poets.flatMap((p) => p.ticketTypes).every((t) => !t.placeholder)).toBe(true)
  })
})

describe('demo availability states', () => {
  it('shows few, sold out and free states on «Три поэта» (demo sales until T-042)', () => {
    const sold = (id: string) =>
      performances.find((p) => p.id === id)?.ticketTypes.reduce((n, t) => n + (t.sold ?? 0), 0)
    expect(sold('three-poets-1020')).toBe(17)
    expect(sold('three-poets-1103')).toBe(20)
    expect(sold('three-poets-1110')).toBe(0)
  })
})

describe('labels', () => {
  it('formats duration and age for display', () => {
    expect(formatDuration(150)).toBe('2 ч 30 мин')
    expect(formatDuration(60)).toBe('1 ч')
    expect(formatDuration(45)).toBe('45 мин')
    expect(formatDuration(null)).toBeNull()
    expect(formatAge(16)).toBe('16+')
  })
})
