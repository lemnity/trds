import { getSeatingPlan, seatsOf, type PerformanceSeating } from '@/modules/seating'

import type {
  Availability,
  EventType,
  AvailabilityLevel,
  Performance,
  PerformanceView,
  Show,
  ShowsData,
  TicketType,
  Venue,
  VenueKind,
} from './types'

// Часовой пояс театра (Екатеринбург). Открытый вопрос memory.md §5 — подтвердить у театра.
export const THEATRE_TIME_ZONE = 'Asia/Yekaterinburg'

const isPublished = (show: Show | undefined): show is Show => show?.status === 'published'

const resolveSeating = (p: Performance): PerformanceSeating | null => {
  if (!p.seating) return null
  const plan = getSeatingPlan(p.seating.planId)
  if (!plan) return null
  return {
    plan,
    pricesKopecks: p.seating.pricesKopecks,
    pricesPlaceholder: p.seating.pricesPlaceholder === true,
    unavailableSeatIds: p.seating.unavailableSeatIds,
  }
}

/** «Мало» — 20% и меньше от вместимости или не больше 3 билетов (для камерных залов). */
export const availabilityLevel = (available: number, capacity: number): AvailabilityLevel =>
  available <= 0 ? 'none' : available * 5 <= capacity || available <= 3 ? 'few' : 'many'

const availabilityOf = (p: Performance, salesOpen: boolean): Availability | null => {
  if (!salesOpen) return null
  const seating = resolveSeating(p)
  if (seating) {
    const capacity = seatsOf(seating.plan).length
    const available = capacity - new Set(seating.unavailableSeatIds).size
    return { available, capacity, level: availabilityLevel(available, capacity) }
  }
  const capacity = p.ticketTypes.reduce((sum, t) => sum + t.capacity, 0)
  const sold = p.ticketTypes.reduce((sum, t) => sum + Math.min(t.sold ?? 0, t.capacity), 0)
  const available = capacity - sold
  return { available, capacity, level: availabilityLevel(available, capacity) }
}

const toView = (data: ShowsData, p: Performance): PerformanceView | null => {
  const show = data.shows.find((s) => s.slug === p.showSlug)
  const venue = data.venues.find((v) => v.id === p.venueId)
  if (!isPublished(show) || !venue) return null
  const seatPrices = p.seating ? Object.values(p.seating.pricesKopecks) : []
  const prices = [...p.ticketTypes.map((t) => t.priceKopecks), ...seatPrices]
  return {
    id: p.id,
    startsAt: p.startsAt,
    show: {
      slug: show.slug,
      title: show.title,
      ageLimit: show.ageLimit,
      genre: show.genre,
      eventType: show.eventType,
      announcedAt: show.announcedAt,
      premiere: show.premiere === true,
      pushkinCard: show.pushkinCard === true,
      studentOffer: show.studentOffer === true,
      imageUrl: show.gallery[0] ?? show.previewUrl ?? show.posterUrl,
    },
    venue,
    minPriceKopecks: prices.length > 0 ? Math.min(...prices) : null,
    pricePlaceholder:
      p.ticketTypes.some((t) => t.placeholder === true) || p.seating?.pricesPlaceholder === true,
    salesOpen: prices.length > 0,
    availability: availabilityOf(p, prices.length > 0),
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

export type SalePerformance = PerformanceView & {
  ticketTypes: TicketType[]
  venue: Venue
  seating: PerformanceSeating | null
}

/** Спектакль и его будущие показы с категориями билетов (пусто — продажи не открыты). */
export const getShowPage = (data: ShowsData, slug: string, now: Date) => {
  const show = data.shows.find((s) => s.slug === slug)
  if (!isPublished(show)) return null
  const performances: SalePerformance[] = listUpcoming(data, now)
    .filter((p) => p.show.slug === slug)
    .map((view) => {
      const source = data.performances.find((p) => p.id === view.id)
      return {
        ...view,
        ticketTypes: source?.ticketTypes ?? [],
        seating: source ? resolveSeating(source) : null,
      }
    })
  return { show, performances }
}

/** Показ, доступный для покупки: будущий, опубликованный, с открытыми продажами (TICKETS-01). */
export const findPerformance = (data: ShowsData, id: string, now: Date): SalePerformance | null => {
  const p = data.performances.find((x) => x.id === id)
  if (!p || !isUpcoming(p, now)) return null
  const view = toView(data, p)
  if (!view?.salesOpen) return null
  return { ...view, ticketTypes: p.ticketTypes, seating: resolveSeating(p) }
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

/**
 * «Для кого»: по возрастному ограничению спектакля и признаку студенческих условий.
 * Детям — 12+ и младше; молодёжи — 16+ и младше; взрослым — 18+; студентам — есть
 * студенческие условия (признак `studentOffer`, заполняет театр). Возраст не указан — ни в одну
 * возрастную группу не попадает.
 */
export const AUDIENCES = [
  { id: 'kids', label: 'Детям' },
  { id: 'youth', label: 'Молодёжи' },
  { id: 'students', label: 'Студентам' },
  { id: 'adults', label: 'Взрослым' },
] as const

export type Audience = (typeof AUDIENCES)[number]['id']

const KIDS_MAX_AGE = 12
const YOUTH_MAX_AGE = 16
const ADULT_AGE = 18

const fitsAudience = (show: PerformanceView['show'], audience: Audience) => {
  const age = show.ageLimit
  switch (audience) {
    case 'kids':
      return age !== null && age <= KIDS_MAX_AGE
    case 'youth':
      return age !== null && age <= YOUTH_MAX_AGE
    case 'adults':
      return age !== null && age >= ADULT_AGE
    case 'students':
      return show.studentOffer
  }
}

export type AfishaFilters = {
  /** Ключ месяца «2026-11» в часовом поясе театра. */
  month?: string
  venueKind?: VenueKind
  eventType?: EventType
  audience?: Audience
  premiere?: boolean
  pushkin?: boolean
  query?: string
}

const normalize = (s: string) => s.toLowerCase().replaceAll('ё', 'е').trim()

export const filterPerformances = (
  items: PerformanceView[],
  f: AfishaFilters,
): PerformanceView[] => {
  const query = f.query ? normalize(f.query) : ''
  return items.filter(
    (p) =>
      (!f.month || formatPerformanceDate(p.startsAt).monthKey === f.month) &&
      (!f.venueKind || p.venue.kind === f.venueKind) &&
      (!f.eventType || p.show.eventType === f.eventType) &&
      (!f.audience || fitsAudience(p.show, f.audience)) &&
      (!f.premiere || p.show.premiere) &&
      (!f.pushkin || p.show.pushkinCard) &&
      (!query ||
        [p.show.title, p.show.genre ?? '', p.venue.title].some((t) =>
          normalize(t).includes(query),
        )),
  )
}

/**
 * Слайды главного экрана: ближайший показ каждого спектакля (первые `limit`) плюс все
 * премьеры, без повторов. Сначала премьеры — самая новая по `announcedAt` первой (без даты
 * анонса — после датированных), при равенстве по дате показа; затем остальные по дате.
 */
export const heroSlides = (data: ShowsData, now: Date, limit: number): PerformanceView[] => {
  const seen = new Set<string>()
  const nextPerShow = listUpcoming(data, now).filter(
    (p) => !seen.has(p.show.slug) && seen.add(p.show.slug),
  )
  const nearest = nextPerShow.slice(0, limit)
  const premieres = nextPerShow
    .filter((p) => p.show.premiere)
    .sort(
      (a, b) => (b.show.announcedAt ?? '').localeCompare(a.show.announcedAt ?? '') || byStart(a, b),
    )
  const rest = nearest.filter((p) => !p.show.premiere).sort(byStart)
  return [...premieres, ...rest]
}
