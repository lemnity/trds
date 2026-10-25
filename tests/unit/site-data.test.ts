import { describe, expect, it, vi } from 'vitest'

import { demoSiteContent } from '../../src/modules/content'
import type { CmsContentDocs } from '../../src/modules/content/cms'
import { demoShowsData, findPerformance, listUpcoming } from '../../src/modules/shows'
import type { CmsShowsDocs } from '../../src/modules/shows/cms'
import {
  contentSource,
  createSiteData,
  isStaticExport,
  payloadReaderFor,
  type CmsReader,
  type StockReader,
} from '../../src/modules/site-data'
import type { Media, Performance, Person, Show, TicketType, Venue } from '../../src/payload-types'

// Read model сайта: CMS (опубликованное) при наличии базы, иначе демо-набор. Типы одни.
const NOW = new Date('2026-11-01T00:00:00Z')
const stamp = { createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }

const media = (id: number, url: string, extra: Partial<Media> = {}): Media => ({
  id,
  alt: 'фото',
  url,
  width: 600,
  height: 800,
  ...stamp,
  ...extra,
})
const person = (id: number, name: string, slug: string, extra: Partial<Person> = {}): Person => ({
  id,
  name,
  slug,
  _status: 'published',
  ...stamp,
  ...extra,
})
const venue: Venue = {
  id: 1,
  code: 'dk',
  title: 'Бар «Дом Культуры»',
  kind: 'bar',
  address: 'ул. Бажова, 193',
  _status: 'published',
  ...stamp,
}
const show: Show = {
  id: 7,
  slug: 'guests',
  title: 'Гости',
  eventType: 'immersive',
  genre: 'Иммерсивный спектакль',
  ageLimit: 18,
  durationMinutes: 90,
  lead: 'Анонс',
  description: 'Первый абзац.\n\nВторой абзац.',
  premiere: true,
  credits: [
    {
      role: 'В ролях',
      entries: [
        // Опубликованный человек приходит документом, черновик — только id: его не показываем.
        { character: 'Габи', people: [person(3, 'Анна Слепых', 'anna-slepykh'), 99] },
        { people: [99] },
      ],
    },
  ],
  poster: media(11, '/api/media/file/guests.jpg'),
  cover: media(12, '/api/media/file/guests-cover.jpg', { focalX: 50, focalY: 80 }),
  gallery: [
    { imageUrl: 'https://static.tildacdn.com/a.jpg' },
    { image: media(13, '/api/media/file/b.jpg') },
  ],
  seo: { title: 'Гости — иммерсивный спектакль' },
  _status: 'published',
  ...stamp,
}
const performance = (
  code: string,
  startsAt: string,
  extra: Partial<Performance> = {},
): Performance => ({
  id: code.length,
  code,
  show,
  venue,
  startsAt,
  _status: 'published',
  ...stamp,
  ...extra,
})
const ticket = (performanceId: number, code: string, priceKopecks: number): TicketType => ({
  id: priceKopecks,
  performance: performanceId,
  code,
  title: code,
  priceKopecks,
  capacity: 20,
  sortOrder: priceKopecks,
  ...stamp,
})

const showsDocs = (): CmsShowsDocs => {
  const open = performance('guests-1115', '2026-11-15T13:00:00.000Z')
  const later = performance('guests-1129', '2026-11-29T13:00:00.000Z', {
    id: 50,
    salesStartAt: '2026-11-10T00:00:00.000Z',
  })
  // Показ неопубликованного спектакля: связь пришла id — показа на сайте нет.
  const orphan = performance('draft-1120', '2026-11-20T13:00:00.000Z', { id: 60, show: 8 })
  return {
    shows: [show],
    venues: [venue],
    performances: [later, open, orphan],
    ticketTypes: [
      ticket(open.id, 'vip', 300_000),
      ticket(open.id, 'standard', 150_000),
      ticket(50, 'standard', 1),
    ],
    archive: [],
  }
}

const contentDocs = (): CmsContentDocs => ({
  news: [],
  reviews: [],
  partners: [
    { id: 1, name: 'No?So', role: 'Костюмы', sortOrder: 0, _status: 'published', ...stamp },
  ],
  documents: [
    {
      id: 1,
      slug: 'refunds',
      title: 'Возврат',
      body: 'Пункт 1.\n\nПункт 2.',
      _status: 'published',
      ...stamp,
    },
    { id: 2, slug: 'privacy', title: 'Политика', _status: 'published', ...stamp },
  ],
  people: [
    person(3, 'Анна Слепых', 'anna-slepykh', {
      portrait: media(20, '/api/media/file/anna.jpg'),
      position: 'Актриса',
      bio: 'Выпускница ЕГТИ.',
      leadership: true,
    }),
  ],
  pages: [],
  settings: {
    id: 1,
    theatreName: 'TURDUS',
    contacts: {
      phone: '8 (982) 657-54-26',
      email: 'theatre@example.com',
      officeAddress: 'Екатеринбург, ул. Малышева, 19',
      officeShort: 'ул. Малышева, 19',
      hours: '10–22',
    },
    social: [{ name: 'Telegram', handle: '@x', href: 'https://t.me/x' }],
  },
})

const reader = (overrides: Partial<CmsReader> = {}): CmsReader => ({
  showsDocs: async () => showsDocs(),
  contentDocs: async () => contentDocs(),
  countAllShows: async () => 1,
  ...overrides,
})
const DB = { DATABASE_URL: 'postgres://x', NODE_ENV: 'development' }
const quiet = { warn: vi.fn() }

describe('content source selection', () => {
  it('uses demo data for the GitHub Pages static export and without a database', () => {
    expect(contentSource({ ...DB, PAGES_EXPORT: '1' })).toBe('demo')
    expect(contentSource({ ...DB, NEXT_PUBLIC_STATIC_PREVIEW: '1' })).toBe('demo')
    expect(contentSource({})).toBe('demo')
    expect(contentSource({ ...DB, CONTENT_SOURCE: 'demo' })).toBe('demo')
    expect(contentSource(DB)).toBe('cms')
    expect(isStaticExport({ PAGES_EXPORT: '1' })).toBe(true)
  })

  it('demo path never touches Payload', async () => {
    const load = vi.fn()
    const site = createSiteData({ reader: load, env: { PAGES_EXPORT: '1', ...DB } })
    expect(await site.loadShowsData()).toBe(demoShowsData)
    expect(await site.loadSiteContent()).toBe(demoSiteContent)
    expect(load).not.toHaveBeenCalled()
  })
})

describe('CMS read model (mocked Payload)', () => {
  const site = createSiteData({ reader: async () => reader(), env: DB, logger: quiet })

  it('maps shows with the same types as the demo data', async () => {
    const data = await site.loadShowsData()
    expect(data.venues).toEqual([
      { id: 'dk', title: 'Бар «Дом Культуры»', address: 'ул. Бажова, 193', kind: 'bar' },
    ])
    const [s] = data.shows
    expect(s).toMatchObject({
      slug: 'guests',
      description: ['Первый абзац.', 'Второй абзац.'],
      premiere: true,
      posterUrl: '/api/media/file/guests.jpg',
      coverUrl: '/api/media/file/guests-cover.jpg',
      coverFocus: '50% 80%',
      gallery: ['https://static.tildacdn.com/a.jpg', '/api/media/file/b.jpg'],
      announcedAt: '2026-10-01',
      seo: { title: 'Гости — иммерсивный спектакль' },
      status: 'published',
    })
    // Неопубликованный человек в составе не показывается; пустая строка состава — тоже.
    expect(s!.credits).toEqual([
      { role: 'В ролях', entries: [{ character: 'Габи', people: ['Анна Слепых'] }] },
    ])
  })

  it('keeps only performances of published shows, theatre time, sorted categories', async () => {
    const data = await site.loadShowsData()
    expect(data.performances.map((p) => p.id)).toEqual(['guests-1115', 'guests-1129'])
    const p = data.performances[0]!
    expect(p.startsAt).toBe('2026-11-15T18:00:00+05:00')
    expect(p.ticketTypes.map((t) => t.id)).toEqual(['standard', 'vip'])
    expect(findPerformance(data, 'guests-1115', NOW)?.minPriceKopecks).toBe(150_000)
  })

  it('respects the sales window from the CMS', async () => {
    const data = await site.loadShowsData()
    const view = (at: Date) => listUpcoming(data, at).find((v) => v.id === 'guests-1129')
    expect(view(NOW)?.salesOpen).toBe(false)
    expect(findPerformance(data, 'guests-1129', NOW)).toBeNull()
    expect(view(new Date('2026-11-12T00:00:00Z'))?.salesOpen).toBe(true)
  })

  it('maps content: documents, people, portraits, contacts from site settings', async () => {
    const c = await site.loadSiteContent()
    expect(c.legalDocuments).toEqual([
      { slug: 'refunds', title: 'Возврат', paragraphs: ['Пункт 1.', 'Пункт 2.'] },
      { slug: 'privacy', title: 'Политика' },
    ])
    expect(c.portraits).toEqual({
      'anna-slepykh': { src: '/api/media/file/anna.jpg', width: 600, height: 800 },
    })
    expect(c.personBios['anna-slepykh']).toMatchObject({
      title: 'Актриса',
      paragraphs: ['Выпускница ЕГТИ.'],
    })
    expect(c.leadership).toEqual([{ name: 'Анна Слепых', position: 'Актриса', source: '' }])
    expect(c.contacts.phone).toEqual({ display: '8 (982) 657-54-26', href: 'tel:+79826575426' })
    expect(c.contacts.email).toBe('theatre@example.com')
    // Страниц «О театре» и «Корпоративы» в CMS нет — тексты остаются из демо-набора.
    expect(c.aboutTheatre).toBe(demoSiteContent.aboutTheatre)
  })
})

// T-042/T-033: страницы показывают остаток ядра продаж; оформление — квоты CMS (решает acquire).
describe('real availability (stock overlay)', () => {
  const soldOut: StockReader = async (ids) =>
    new Map(
      ids
        .filter((id) => id === 'guests-1115')
        .map((id) => [
          id,
          {
            categories: [
              { ticketTypeId: 'standard', capacity: 20, sold: 19, held: 1 },
              { ticketTypeId: 'vip', capacity: 20, sold: 20, held: 0 },
            ],
            unavailableSeatIds: [],
          },
        ]),
    )

  it('pages: one batched stock call for future performances; sold out → level none', async () => {
    const stock = vi.fn(soldOut)
    const site = createSiteData({
      reader: async () => reader(),
      stock,
      env: DB,
      logger: quiet,
      now: () => NOW,
    })
    const data = await site.loadSiteShows()
    expect(stock).toHaveBeenCalledTimes(1)
    expect(stock).toHaveBeenCalledWith(['guests-1115', 'guests-1129'])
    const view = listUpcoming(data, NOW).find((p) => p.id === 'guests-1115')
    expect(view?.availability).toEqual({ available: 0, capacity: 40, level: 'none' })
  })

  it('checkout data (loadShowsData) stays on CMS quotas; demo path never asks the stock', async () => {
    const stock = vi.fn(soldOut)
    const site = createSiteData({ reader: async () => reader(), stock, env: DB, now: () => NOW })
    const raw = await site.loadShowsData()
    expect(listUpcoming(raw, NOW).find((p) => p.id === 'guests-1115')?.availability?.level).toBe(
      'many',
    )
    const demo = createSiteData({
      reader: async () => reader(),
      stock,
      env: { ...DB, PAGES_EXPORT: '1' },
    })
    expect(await demo.loadSiteShows()).toBe(demoShowsData)
    const empty = createSiteData({
      reader: async () => reader({ countAllShows: async () => 0 }),
      stock,
      env: DB,
      logger: quiet,
    })
    expect(await empty.loadSiteShows()).toBe(demoShowsData)
    expect(stock).not.toHaveBeenCalled()
  })

  it('stock read failure → CMS quotas with a warning, the afisha still renders', async () => {
    const warn = vi.fn()
    const site = createSiteData({
      reader: async () => reader(),
      stock: async () => {
        throw new Error('ECONNRESET')
      },
      env: { ...DB, NODE_ENV: 'production' },
      logger: { warn },
      now: () => NOW,
    })
    const data = await site.loadSiteShows()
    expect(data.performances.map((p) => p.id)).toEqual(['guests-1115', 'guests-1129'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('остатки недоступны'))
  })
})

describe('fallback rules', () => {
  it('outside production: empty (not seeded) or unavailable CMS → demo with a warning', async () => {
    const warn = vi.fn()
    const empty = createSiteData({
      reader: async () => reader({ countAllShows: async () => 0 }),
      env: DB,
      logger: { warn },
    })
    expect(await empty.loadShowsData()).toBe(demoShowsData)
    const down = createSiteData({
      reader: async () => {
        throw new Error('ECONNREFUSED')
      },
      env: DB,
      logger: { warn },
    })
    expect(await down.loadSiteContent()).toBe(demoSiteContent)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('in production (or CONTENT_SOURCE=cms) never silently serves demo data', async () => {
    const failing = async (): Promise<CmsReader> => {
      throw new Error('ECONNREFUSED')
    }
    for (const env of [
      { ...DB, NODE_ENV: 'production' },
      { ...DB, CONTENT_SOURCE: 'cms' },
    ]) {
      await expect(
        createSiteData({ reader: failing, env, logger: quiet }).loadShowsData(),
      ).rejects.toThrow()
      const empty = createSiteData({
        reader: async () =>
          reader({
            countAllShows: async () => 0,
            showsDocs: async () => ({ ...showsDocs(), shows: [], performances: [] }),
          }),
        env,
        logger: quiet,
      })
      expect((await empty.loadShowsData()).shows).toEqual([])
    }
  })
})

describe('Payload reader', () => {
  it('asks Payload for published documents only, with anonymous access', async () => {
    const calls: Record<string, unknown>[] = []
    const fake = {
      find: async (args: Record<string, unknown>) => {
        calls.push(args)
        return { docs: [] }
      },
      findGlobal: async () => ({ contacts: {} }),
      count: async () => ({ totalDocs: 0 }),
    }
    const r = payloadReaderFor(fake as never)
    await r.showsDocs()
    await r.contentDocs()
    for (const call of calls) {
      expect(call, String(call.collection)).toMatchObject({ draft: false, overrideAccess: false })
      if (call.collection !== 'ticket-types')
        expect(call.where, String(call.collection)).toEqual({ _status: { equals: 'published' } })
    }
    expect(calls).toHaveLength(11)
  })
})
