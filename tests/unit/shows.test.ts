import { describe, expect, it } from 'vitest'

import {
  availabilityLevel,
  availabilityText,
  filterPerformances,
  findPerformance,
  formatPerformanceDate,
  getShowPage,
  heroSlides,
  groupByMonth,
  listUpcoming,
  type ShowsData,
} from '../../src/modules/shows'

const data: ShowsData = {
  venues: [
    { id: 'bar', title: 'Бар', address: 'ул. Бажова, 193', kind: 'bar' },
    { id: 'flat', title: 'Квартира', address: 'ул. Юмашева, 10', kind: 'apartment' },
  ],
  shows: [
    {
      slug: 'a',
      title: 'Спектакль А',
      premiere: true,
      genre: null,
      ageLimit: 16,
      durationMinutes: 60,
      lead: 'А',
      description: [],
      credits: [],
      gallery: [],
      eventType: 'spectacle',
      posterUrl: 'https://example.test/a.jpg',
      status: 'published',
    },
    {
      slug: 'draft',
      title: 'Черновик',
      genre: null,
      ageLimit: null,
      durationMinutes: null,
      lead: '',
      description: [],
      credits: [],
      gallery: [],
      eventType: 'spectacle',
      posterUrl: 'https://example.test/d.jpg',
      status: 'draft',
    },
  ],
  performances: [
    {
      id: 'a-2',
      showSlug: 'a',
      venueId: 'flat',
      startsAt: '2026-11-03T19:00:00+05:00',
      ticketTypes: [],
    },
    {
      id: 'a-1',
      showSlug: 'a',
      venueId: 'bar',
      startsAt: '2026-10-20T19:00:00+05:00',
      ticketTypes: [
        { id: 'std', title: 'Входной', priceKopecks: 150_000, capacity: 20 },
        { id: 'vip', title: 'Столик', priceKopecks: 100_000, capacity: 8, sold: 3 },
      ],
    },
    {
      id: 'a-past',
      showSlug: 'a',
      venueId: 'bar',
      startsAt: '2026-10-01T19:00:00+05:00',
      ticketTypes: [],
    },
    {
      id: 'seated-priced',
      showSlug: 'a',
      venueId: 'bar',
      startsAt: '2026-12-01T19:00:00+05:00',
      ticketTypes: [],
      seating: {
        planId: 'dom-aktera',
        pricesKopecks: { 'cat-1': 300_000, 'cat-7': 90_000 },
        unavailableSeatIds: ['r1-s1'],
      },
    },
    {
      id: 'seated-unpriced',
      showSlug: 'a',
      venueId: 'bar',
      startsAt: '2026-12-02T19:00:00+05:00',
      ticketTypes: [],
      seating: { planId: 'dom-aktera', pricesKopecks: {}, unavailableSeatIds: [] },
    },
    {
      id: 'draft-1',
      showSlug: 'draft',
      venueId: 'bar',
      startsAt: '2026-10-25T19:00:00+05:00',
      ticketTypes: [],
    },
  ],
}

const now = new Date('2026-10-15T12:00:00+05:00')

describe('listUpcoming', () => {
  it('returns only future performances of published shows, soonest first', () => {
    expect(listUpcoming(data, now).map((p) => p.id)).toEqual([
      'a-1',
      'a-2',
      'seated-priced',
      'seated-unpriced',
    ])
  })

  it('exposes the cheapest price and whether sales are open on the site', () => {
    const [first, second] = listUpcoming(data, now)
    expect(first).toMatchObject({
      minPriceKopecks: 100_000,
      salesOpen: true,
      pricePlaceholder: false,
    })
    expect(second).toMatchObject({ minPriceKopecks: null, salesOpen: false })
  })

  it('joins the venue and the show summary', () => {
    const [first] = listUpcoming(data, now)
    expect(first?.venue.kind).toBe('bar')
    expect(first?.show).toMatchObject({ slug: 'a', title: 'Спектакль А', ageLimit: 16 })
  })
})

describe('availability', () => {
  it('sums category quotas minus sold tickets', () => {
    const [first] = listUpcoming(data, now)
    expect(first?.availability).toEqual({ available: 25, capacity: 28, level: 'many' })
  })

  it('counts free seats on the seating plan minus unavailable seats', () => {
    const priced = listUpcoming(data, now).find((p) => p.id === 'seated-priced')
    expect(priced?.availability).toEqual({ available: 135, capacity: 136, level: 'many' })
  })

  it('is unknown while sales on the site are closed', () => {
    const closed = listUpcoming(data, now).find((p) => p.id === 'a-2')
    expect(closed?.availability).toBeNull()
  })
})

describe('availabilityText', () => {
  it('shows free of total, few left, sold out and closed sales', () => {
    expect(availabilityText({ available: 18, capacity: 20, level: 'many' })).toBe(
      'Свободно 18 из 20',
    )
    expect(availabilityText({ available: 3, capacity: 20, level: 'few' })).toBe('Осталось 3 билета')
    expect(availabilityText({ available: 1, capacity: 20, level: 'few' })).toBe('Остался 1 билет')
    expect(availabilityText({ available: 0, capacity: 20, level: 'none' })).toBe('Билетов нет')
    expect(availabilityText(null)).toBe('Продажа на сайте не открыта')
  })
})

describe('availabilityLevel', () => {
  it('marks few tickets at 20% or less and sold out at zero', () => {
    expect(availabilityLevel(0, 20)).toBe('none')
    expect(availabilityLevel(4, 20)).toBe('few')
    expect(availabilityLevel(5, 20)).toBe('many')
    expect(availabilityLevel(1, 3)).toBe('few')
  })
})

describe('filterPerformances', () => {
  const all = () => listUpcoming(data, now)

  it('returns everything without filters', () => {
    expect(filterPerformances(all(), {}).map((p) => p.id)).toEqual(all().map((p) => p.id))
  })

  it('filters by month, venue kind and event type', () => {
    expect(filterPerformances(all(), { month: '2026-11' }).map((p) => p.id)).toEqual(['a-2'])
    expect(filterPerformances(all(), { venueKind: 'apartment' }).map((p) => p.id)).toEqual(['a-2'])
    expect(filterPerformances(all(), { eventType: 'concert' })).toEqual([])
  })

  it('filters premieres, kids shows and Pushkin card', () => {
    expect(filterPerformances(all(), { premiere: true })).toHaveLength(4)
    expect(filterPerformances(all(), { kids: true })).toEqual([])
    expect(filterPerformances(all(), { pushkin: true })).toEqual([])
  })

  it('searches by title ignoring case and ё', () => {
    expect(filterPerformances(all(), { query: 'спектакль а' })).toHaveLength(4)
    expect(filterPerformances(all(), { query: 'нет такого' })).toEqual([])
  })
})

describe('heroSlides', () => {
  it('takes the next performance of each show plus premieres, without duplicates', () => {
    const slides = heroSlides(data, now, 4)
    expect(slides.map((p) => p.id)).toEqual(['a-1'])
  })

  it('adds premieres beyond the nearest limit and keeps the order by date', () => {
    const withMore: ShowsData = {
      ...data,
      shows: [
        ...data.shows,
        { ...data.shows[0]!, slug: 'b', title: 'Б', premiere: false },
        { ...data.shows[0]!, slug: 'c', title: 'В', premiere: true },
      ],
      performances: [
        ...data.performances,
        {
          id: 'b-1',
          showSlug: 'b',
          venueId: 'bar',
          startsAt: '2026-10-16T19:00:00+05:00',
          ticketTypes: [],
        },
        {
          id: 'c-1',
          showSlug: 'c',
          venueId: 'bar',
          startsAt: '2026-12-20T19:00:00+05:00',
          ticketTypes: [],
        },
      ],
    }
    expect(heroSlides(withMore, now, 1).map((p) => p.id)).toEqual(['b-1', 'a-1', 'c-1'])
  })
})

describe('getShowPage', () => {
  it('returns a published show with its upcoming performances', () => {
    const page = getShowPage(data, 'a', now)
    expect(page?.show.title).toBe('Спектакль А')
    expect(page?.performances.map((p) => p.id)).toEqual([
      'a-1',
      'a-2',
      'seated-priced',
      'seated-unpriced',
    ])
  })

  it('resolves the seating plan and opens sales only when seat prices are set', () => {
    const page = getShowPage(data, 'a', now)
    const priced = page?.performances.find((p) => p.id === 'seated-priced')
    const unpriced = page?.performances.find((p) => p.id === 'seated-unpriced')
    expect(priced?.seating?.plan.id).toBe('dom-aktera')
    expect(priced?.seating?.unavailableSeatIds).toEqual(['r1-s1'])
    expect(priced).toMatchObject({ salesOpen: true, minPriceKopecks: 90_000 })
    expect(unpriced).toMatchObject({ salesOpen: false, minPriceKopecks: null })
    expect(page?.performances.find((p) => p.id === 'a-1')?.seating).toBeNull()
  })

  it('includes ticket categories and the venue address for booking', () => {
    const page = getShowPage(data, 'a', now)
    expect(page?.performances[0]?.ticketTypes.map((t) => t.id)).toEqual(['std', 'vip'])
    expect(page?.performances[1]?.ticketTypes).toEqual([])
    expect(page?.performances[0]?.venue.address).toBe('ул. Бажова, 193')
  })

  it('hides drafts and unknown slugs', () => {
    expect(getShowPage(data, 'draft', now)).toBeNull()
    expect(getShowPage(data, 'missing', now)).toBeNull()
  })
})

describe('findPerformance', () => {
  it('finds a future performance with open sales', () => {
    expect(findPerformance(data, 'a-1', now)?.ticketTypes).toHaveLength(2)
  })

  it('does not offer past performances or drafts for sale', () => {
    expect(findPerformance(data, 'a-past', now)).toBeNull()
    expect(findPerformance(data, 'draft-1', now)).toBeNull()
  })
})

describe('groupByMonth', () => {
  it('groups by month in the theatre time zone', () => {
    const groups = groupByMonth(listUpcoming(data, now))
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ['Октябрь 2026', 1],
      ['Ноябрь 2026', 1],
      ['Декабрь 2026', 2],
    ])
  })
})

describe('formatPerformanceDate', () => {
  it('formats in the theatre time zone regardless of the server zone', () => {
    // 23:30 по Екатеринбургу — это уже следующий день по UTC.
    expect(formatPerformanceDate('2026-10-20T23:30:00+05:00')).toEqual({
      day: '20',
      month: 'окт',
      weekday: 'вт',
      time: '23:30',
      monthKey: '2026-10',
      longDate: '20 октября',
    })
  })
})
