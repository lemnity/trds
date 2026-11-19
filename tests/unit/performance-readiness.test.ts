import { describe, expect, it } from 'vitest'

import { getSeatingPlan, seatsOf } from '@/modules/seating'
import { performanceReadiness } from '@/payload/components/performances/readiness'

const now = new Date('2026-11-19T10:00:00Z')
const base = {
  performance: { startsAt: '2026-12-01T14:00:00.000Z', salesStartAt: '2026-11-20T05:00:00.000Z' },
  ticketTypes: [{ code: 'standard' }],
  showStatus: 'published' as const,
  venueStatus: 'published' as const,
  performanceStatus: 'published' as const,
  now,
}
const state = (r: ReturnType<typeof performanceReadiness>, id: string) =>
  r.items.find((i) => i.id === id)?.state

describe('performanceReadiness', () => {
  it('everything in place — ready', () => {
    const r = performanceReadiness(base)
    expect(r.ready).toBe(true)
    expect(r.problems).toEqual([])
    expect(r.items.every((i) => i.state === 'ok')).toBe(true)
  })

  it('draft show and venue block sales', () => {
    const r = performanceReadiness({ ...base, showStatus: 'draft', venueStatus: 'draft' })
    expect(r.ready).toBe(false)
    expect(r.problems).toEqual(['спектакль не опубликован', 'площадка не опубликована'])
  })

  it('unselected show/venue block sales with a pick hint', () => {
    const r = performanceReadiness({ ...base, showStatus: null })
    expect(state(r, 'show')).toBe('fail')
    expect(r.items[0]?.hint).toContain('Выберите')
  })

  it('past or missing date blocks sales', () => {
    const past = performanceReadiness({
      ...base,
      performance: { ...base.performance, startsAt: '2026-11-01T14:00:00.000Z' },
    })
    expect(state(past, 'date')).toBe('fail')
    const none = performanceReadiness({
      ...base,
      performance: { ...base.performance, startsAt: '' },
    })
    expect(none.problems).toContain('не указана дата')
  })

  it('no prices blocks sales', () => {
    const r = performanceReadiness({ ...base, ticketTypes: [] })
    expect(r.ready).toBe(false)
    expect(r.problems).toEqual(['нет цен'])
  })

  it('empty «Продажи с» is a warning, not an error', () => {
    const r = performanceReadiness({
      ...base,
      performance: { startsAt: base.performance.startsAt },
    })
    expect(state(r, 'window')).toBe('warn')
    expect(r.ready).toBe(true)
  })

  it('sales not started yet is fine and names the opening date', () => {
    const r = performanceReadiness(base)
    expect(state(r, 'window')).toBe('ok')
    expect(r.items.find((i) => i.id === 'window')?.hint).toContain('откроются')
  })

  it('sales window already over blocks sales', () => {
    const r = performanceReadiness({
      ...base,
      performance: { ...base.performance, salesStartAt: null, salesEndAt: '2026-11-18T00:00:00Z' },
    })
    expect(r.problems).toContain('окно продаж закрыто')
  })

  it('draft performance is never ready', () => {
    const r = performanceReadiness({ ...base, performanceStatus: 'draft' })
    expect(r.ready).toBe(false)
    expect(r.problems).toEqual(['показ не опубликован'])
    expect(r.items.find((i) => i.id === 'performance')?.hint).toBe(
      'Опубликуйте показ — черновики на сайте не видны.',
    )
  })

  describe('seat scheme prices', () => {
    const seatPerf = (pricing: unknown) => ({
      ...base.performance,
      seating: { planId: 'belinskogo', pricing },
    })
    const plan = getSeatingPlan('belinskogo')!
    const allSeats = seatsOf(plan).map((s) => s.id)
    const priced = {
      zones: [{ categoryId: 'cat-1', title: 'Партер', priceKopecks: 150000 }],
      seats: {},
    }
    const pricedAll = {
      ...priced,
      seats: Object.fromEntries(allSeats.map((id) => [id, 'cat-1'])),
    }

    it('priced zone with open seats — ok', () => {
      const r = performanceReadiness({
        ...base,
        ticketTypes: [],
        performance: seatPerf(pricedAll),
      })
      expect(state(r, 'prices')).toBe('ok')
    })

    it('priced zone with every seat closed — fails with a hint', () => {
      const r = performanceReadiness({
        ...base,
        ticketTypes: [],
        performance: seatPerf(pricedAll),
        closedSeatIds: allSeats,
      })
      expect(state(r, 'prices')).toBe('fail')
      expect(r.items.find((i) => i.id === 'prices')?.hint).toBe(
        'У зон с ценой нет мест в продаже — откройте места на схеме.',
      )
    })

    it('priced zone without seats — fails', () => {
      const empty = {
        zones: [{ categoryId: 'cat-9', title: 'Пусто', priceKopecks: 1000 }],
        seats: {},
      }
      const r = performanceReadiness({ ...base, ticketTypes: [], performance: seatPerf(empty) })
      expect(state(r, 'prices')).toBe('fail')
    })
  })
})
