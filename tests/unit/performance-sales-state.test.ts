import { describe, expect, it } from 'vitest'

import { formatTheatreDateTime, salesStatusText } from '@/payload/components/performances/format'
import { performanceSalesState } from '@/payload/components/performances/salesState'

const now = new Date('2026-11-19T10:00:00Z')
const future = '2026-12-01T14:00:00.000Z'
const past = '2026-11-01T14:00:00.000Z'
const ticket = { code: 'standard' }

const perf = (patch: Record<string, unknown> = {}) => ({ startsAt: future, ...patch })

describe('performanceSalesState: prices', () => {
  it('no ticket types and no hall scheme — no prices', () => {
    const s = performanceSalesState(perf(), [], now)
    expect(s.hasPrices).toBe(false)
    expect(s.status).toEqual({ kind: 'noPrices' })
  })

  it('any ticket type is a price (free ticket included)', () => {
    expect(performanceSalesState(perf(), [ticket], now).status).toEqual({ kind: 'open' })
  })

  it('seat scheme: at least one priced zone', () => {
    const pricing = {
      zones: [
        { categoryId: 'cat-1', title: 'Партер', priceKopecks: 150000 },
        { categoryId: 'cat-2', title: 'Балкон', priceKopecks: null },
      ],
      seats: {},
    }
    const s = performanceSalesState(perf({ seating: { planId: 'belinskogo', pricing } }), [], now)
    expect(s.hasPrices).toBe(true)
  })

  it('seat scheme: zones without prices — no prices', () => {
    const pricing = {
      zones: [{ categoryId: 'cat-1', title: 'Партер', priceKopecks: null }],
      seats: {},
    }
    const s = performanceSalesState(perf({ seating: { planId: 'belinskogo', pricing } }), [], now)
    expect(s.hasPrices).toBe(false)
  })

  it('broken pricing JSON counts as no prices (as on the site)', () => {
    const s = performanceSalesState(
      perf({ seating: { planId: 'belinskogo', pricing: { zones: 'x' } } }),
      [],
      now,
    )
    expect(s.hasPrices).toBe(false)
  })

  it('seat pricing without a scheme is not sold', () => {
    const pricing = { zones: [{ categoryId: 'cat-1', title: 'П', priceKopecks: 100 }], seats: {} }
    expect(performanceSalesState(perf({ seating: { pricing } }), [], now).hasPrices).toBe(false)
  })

  it('zone plan: needs a zone with price and capacity > 0', () => {
    const zone = (priceKopecks: number | null, capacity: number | null) => ({
      seating: {
        planId: 'khlebozavod',
        pricing: { zones: [{ categoryId: 'bulochka', title: 'Партер', priceKopecks, capacity }] },
      },
    })
    expect(performanceSalesState(perf(zone(100000, 40)), [], now).hasPrices).toBe(true)
    expect(performanceSalesState(perf(zone(100000, 0)), [], now).hasPrices).toBe(false)
    expect(performanceSalesState(perf(zone(100000, null)), [], now).hasPrices).toBe(false)
    expect(performanceSalesState(perf(zone(null, 40)), [], now).hasPrices).toBe(false)
  })

  it('zone plan: a ticket type shadowed by a priced zone does not count on its own', () => {
    const seating = {
      planId: 'khlebozavod',
      pricing: { zones: [{ categoryId: 'bulochka', title: 'П', priceKopecks: 100, capacity: 0 }] },
    }
    expect(performanceSalesState(perf({ seating }), [{ code: 'bulochka' }], now).hasPrices).toBe(
      false,
    )
    expect(performanceSalesState(perf({ seating }), [{ code: 'extra' }], now).hasPrices).toBe(true)
  })
})

describe('performanceSalesState: sales window', () => {
  it('empty window — open until the start of the show', () => {
    const s = performanceSalesState(perf(), [ticket], now)
    expect(s.window).toEqual({ state: 'open' })
    expect(s.isPast).toBe(false)
  })

  it('sales start later — opens on that date', () => {
    const s = performanceSalesState(
      perf({ salesStartAt: '2026-11-25T05:00:00.000Z' }),
      [ticket],
      now,
    )
    expect(s.window).toEqual({ state: 'notYet', opensAt: '2026-11-25T05:00:00.000Z' })
    expect(s.status).toEqual({ kind: 'opensLater', opensAt: '2026-11-25T05:00:00.000Z' })
  })

  it('sales start exactly now — open', () => {
    const s = performanceSalesState(perf({ salesStartAt: now.toISOString() }), [ticket], now)
    expect(s.status).toEqual({ kind: 'open' })
  })

  it('sales end in the past or exactly now — closed', () => {
    for (const salesEndAt of ['2026-11-18T00:00:00.000Z', now.toISOString()]) {
      const s = performanceSalesState(perf({ salesEndAt }), [ticket], now)
      expect(s.window).toEqual({ state: 'ended' })
      expect(s.status).toEqual({ kind: 'closed' })
    }
  })

  it('past performance — closed, even without prices', () => {
    const s = performanceSalesState(perf({ startsAt: past }), [], now)
    expect(s.isPast).toBe(true)
    expect(s.status).toEqual({ kind: 'closed' })
  })

  it('performance starting right now is past', () => {
    expect(performanceSalesState(perf({ startsAt: now.toISOString() }), [ticket], now).isPast).toBe(
      true,
    )
  })

  it('no prices wins over a future sales start', () => {
    const s = performanceSalesState(perf({ salesStartAt: '2026-11-25T05:00:00.000Z' }), [], now)
    expect(s.status).toEqual({ kind: 'noPrices' })
  })
})

describe('performance row texts', () => {
  it('date and time in the theatre time zone (UTC+5)', () => {
    expect(formatTheatreDateTime('2026-12-04T14:00:00.000Z')).toBe('пт, 4 декабря 2026, 19:00')
    expect(formatTheatreDateTime('2026-12-04T14:00:00.000Z', { weekday: false })).toBe(
      '4 декабря 2026, 19:00',
    )
  })

  it('sales status texts', () => {
    expect(salesStatusText({ kind: 'open' })).toBe('открыты')
    expect(salesStatusText({ kind: 'noPrices' })).toBe('нет цен')
    expect(salesStatusText({ kind: 'closed' })).toBe('закрыты')
    expect(salesStatusText({ kind: 'opensLater', opensAt: '2026-11-25T05:00:00.000Z' })).toBe(
      'откроются 25 ноября 2026, 10:00',
    )
  })
})
