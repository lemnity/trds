import type { Performance, PerformanceView, Show, ShowsData, TicketType, Venue } from './types'

// Часовой пояс театра (Екатеринбург). Открытый вопрос memory.md §5 — подтвердить у театра.
export const THEATRE_TIME_ZONE = 'Asia/Yekaterinburg'

const isPublished = (show: Show | undefined): show is Show => show?.status === 'published'

const toView = (data: ShowsData, p: Performance): PerformanceView | null => {
  const show = data.shows.find((s) => s.slug === p.showSlug)
  const venue = data.venues.find((v) => v.id === p.venueId)
  if (!isPublished(show) || !venue) return null
  const prices = p.ticketTypes.map((t) => t.priceKopecks)
  return {
    id: p.id,
    startsAt: p.startsAt,
    show: { slug: show.slug, title: show.title, ageLimit: show.ageLimit, genre: show.genre },
    venue,
    minPriceKopecks: prices.length > 0 ? Math.min(...prices) : null,
    salesOpen: p.ticketTypes.length > 0,
  }
}

const isUpcoming = (p: { startsAt: string }, now: Date) =>
  new Date(p.startsAt).getTime() > now.getTime()

const byStart = (a: { startsAt: string }, b: { startsAt: string }) =>
  new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()

/** Будущие показы опубликованных спектаклей, ближайшие первыми (WEB-02). */
export const listUpcoming = (data: ShowsData, now: Date): PerformanceView[] =>
  data.performances
    .filter((p) => isUpcoming(p, now))
    .map((p) => toView(data, p))
    .filter((v): v is PerformanceView => v !== null)
    .sort(byStart)

export const listPublishedShows = (data: ShowsData): Show[] => data.shows.filter(isPublished)

export type SalePerformance = PerformanceView & { ticketTypes: TicketType[]; venue: Venue }

/** Спектакль и его будущие показы с категориями билетов (пусто — продажи не открыты). */
export const getShowPage = (data: ShowsData, slug: string, now: Date) => {
  const show = data.shows.find((s) => s.slug === slug)
  if (!isPublished(show)) return null
  const performances: SalePerformance[] = listUpcoming(data, now)
    .filter((p) => p.show.slug === slug)
    .map((view) => ({
      ...view,
      ticketTypes: data.performances.find((p) => p.id === view.id)?.ticketTypes ?? [],
    }))
  return { show, performances }
}

/** Показ, доступный для покупки: будущий, опубликованный, с открытыми продажами (TICKETS-01). */
export const findPerformance = (data: ShowsData, id: string, now: Date): SalePerformance | null => {
  const p = data.performances.find((x) => x.id === id)
  if (!p || !isUpcoming(p, now) || p.ticketTypes.length === 0) return null
  const view = toView(data, p)
  return view ? { ...view, ticketTypes: p.ticketTypes } : null
}

const partsFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: THEATRE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const dayMonthLong = new Intl.DateTimeFormat('ru-RU', {
  timeZone: THEATRE_TIME_ZONE,
  day: 'numeric',
  month: 'long',
})
const monthShort = new Intl.DateTimeFormat('ru-RU', { timeZone: THEATRE_TIME_ZONE, month: 'short' })
const monthLong = new Intl.DateTimeFormat('ru-RU', {
  timeZone: THEATRE_TIME_ZONE,
  month: 'long',
  year: 'numeric',
})

export type PerformanceDate = {
  day: string
  month: string
  weekday: string
  time: string
  monthKey: string
  /** «20 октября» */
  longDate: string
}

export const formatPerformanceDate = (iso: string): PerformanceDate => {
  const date = new Date(iso)
  const parts = Object.fromEntries(partsFormatter.formatToParts(date).map((p) => [p.type, p.value]))
  return {
    day: parts.day ?? '',
    month: monthShort.format(date).replace('.', ''),
    weekday: parts.weekday ?? '',
    time: `${parts.hour}:${parts.minute}`,
    monthKey: `${parts.year}-${parts.month}`,
    longDate: dayMonthLong.format(date),
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export type MonthGroup = { key: string; label: string; items: PerformanceView[] }

export const groupByMonth = (items: PerformanceView[]): MonthGroup[] => {
  const groups = new Map<string, MonthGroup>()
  for (const item of items) {
    const key = formatPerformanceDate(item.startsAt).monthKey
    const label = capitalize(monthLong.format(new Date(item.startsAt)).replace(' г.', ''))
    const group = groups.get(key) ?? { key, label, items: [] }
    group.items.push(item)
    groups.set(key, group)
  }
  return [...groups.values()]
}
