import { describe, expect, it } from 'vitest'

import {
  HALL_PLAN_OPTIONS,
  completeZonePricing,
  getSeatingPlan,
  getZonePlan,
  khlebozavodPlan,
  parseSeatPricing,
  validateSeatPricing,
  withZoneColors,
  zoneColorsOf,
  zoneTicketTypes,
} from '../../src/modules/seating'
import { inventoryPerformance } from '../../src/payload/hooks/inventorySync'

const pricing = {
  zones: [
    { categoryId: 'bulochka', title: 'Партер «Булочка»', priceKopecks: 250_000, capacity: 40 },
    { categoryId: 'keks', title: 'Галерка «Кекс»', priceKopecks: 120_000, capacity: 30 },
    { categoryId: 'rogalik', title: 'Галерка 2 «Рогалик»', priceKopecks: null, capacity: 20 },
  ],
  seats: {},
}

describe('Хлебозавод zone plan', () => {
  it('is registered as a zone plan with four zones from the stage', () => {
    expect(getZonePlan('khlebozavod')).toBe(khlebozavodPlan)
    expect(getSeatingPlan('khlebozavod')).toBeNull()
    expect(khlebozavodPlan.zones.map((z) => z.id)).toEqual(['bulochka', 'sdoba', 'keks', 'rogalik'])
    expect(HALL_PLAN_OPTIONS.map((o) => o.value)).toContain('khlebozavod')
  })

  it('validates zone ids and capacity against the plan', () => {
    expect(parseSeatPricing(pricing, 'khlebozavod').ok).toBe(true)
    expect(validateSeatPricing(pricing, 'dom-aktera')).not.toBe(true)
    expect(
      parseSeatPricing(
        { zones: [{ categoryId: 'cat-1', title: 'A', priceKopecks: 1 }] },
        'khlebozavod',
      ),
    ).toEqual({ ok: false, error: 'BAD_ZONE' })
    expect(
      parseSeatPricing(
        { zones: [{ categoryId: 'keks', title: 'A', priceKopecks: 1, capacity: -1 }] },
        'khlebozavod',
      ),
    ).toEqual({ ok: false, error: 'BAD_CAPACITY' })
  })

  it('completes pricing with every zone in plan order', () => {
    const full = completeZonePricing(khlebozavodPlan, pricing)
    expect(full.zones.map((z) => z.categoryId)).toEqual(['bulochka', 'sdoba', 'keks', 'rogalik'])
    expect(full.zones[1]).toEqual({
      categoryId: 'sdoba',
      title: 'Амфитеатр «Сдоба»',
      priceKopecks: null,
      capacity: null,
    })
  })

  it('sells priced zones as ticket types keyed by zone id', () => {
    expect(zoneTicketTypes(khlebozavodPlan, pricing)).toEqual([
      { id: 'bulochka', title: 'Партер «Булочка»', priceKopecks: 250_000, capacity: 40 },
      { id: 'keks', title: 'Галерка «Кекс»', priceKopecks: 120_000, capacity: 30 },
    ])
  })

  it('syncs zones to inventory as categories, without seats', () => {
    const perf = inventoryPerformance(
      { id: 1, code: 'p-1', seating: { planId: 'khlebozavod', pricing } },
      [{ id: 9, code: 'standard', title: 'Входной', capacity: 10, priceKopecks: 100 }],
    )
    expect(perf.seating).toBeUndefined()
    expect(perf.ticketTypes.map((t) => [t.id, t.capacity])).toEqual([
      ['standard', 10],
      ['bulochka', 40],
      ['keks', 30],
    ])
  })

  it('keeps custom zone colours and applies them to the plan for the site', () => {
    const parsed = parseSeatPricing(
      { zones: [{ categoryId: 'sdoba', title: 'A', priceKopecks: 1, color: '#7A3FB0' }] },
      'khlebozavod',
    )
    expect(parsed.ok && parsed.pricing!.zones[0]!.color).toBe('#7a3fb0')
    const colors = zoneColorsOf(parsed.ok ? parsed.pricing : null)
    expect(withZoneColors(khlebozavodPlan, colors).zones[1]!.color).toBe('#7a3fb0')
    expect(withZoneColors(khlebozavodPlan, colors).zones[0]!.color).toBe('#e30613')
    expect(
      parseSeatPricing(
        { zones: [{ categoryId: 'sdoba', title: 'A', priceKopecks: 1, color: 'red' }] },
        'khlebozavod',
      ),
    ).toEqual({ ok: false, error: 'BAD_COLOR' })
  })
})
