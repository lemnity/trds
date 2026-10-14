import { describe, expect, it } from 'vitest'

import {
  findPerformance,
  formatPerformanceDate,
  getShowPage,
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
      genre: null,
      ageLimit: 16,
      durationMinutes: 60,
      lead: 'А',
      description: [],
      credits: [],
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
        { id: 'vip', title: 'Столик', priceKopecks: 100_000, capacity: 8 },
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
    expect(listUpcoming(data, now).map((p) => p.id)).toEqual(['a-1', 'a-2'])
  })

  it('exposes the cheapest price and whether sales are open on the site', () => {
    const [first, second] = listUpcoming(data, now)
    expect(first).toMatchObject({ minPriceKopecks: 100_000, salesOpen: true })
    expect(second).toMatchObject({ minPriceKopecks: null, salesOpen: false })
  })

  it('joins the venue and the show summary', () => {
    const [first] = listUpcoming(data, now)
    expect(first?.venue.kind).toBe('bar')
    expect(first?.show).toMatchObject({ slug: 'a', title: 'Спектакль А', ageLimit: 16 })
  })
})

describe('getShowPage', () => {
  it('returns a published show with its upcoming performances', () => {
    const page = getShowPage(data, 'a', now)
    expect(page?.show.title).toBe('Спектакль А')
    expect(page?.performances.map((p) => p.id)).toEqual(['a-1', 'a-2'])
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
