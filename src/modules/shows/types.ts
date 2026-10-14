export type VenueKind = 'bar' | 'restaurant' | 'loft' | 'apartment' | 'stage' | 'city'

export type Venue = {
  id: string
  title: string
  address: string
  kind: VenueKind
}

export type TicketType = {
  id: string
  title: string
  priceKopecks: number
  capacity: number
}

export type Credit = {
  role: string
  names: string
}

export type Show = {
  slug: string
  title: string
  genre: string | null
  ageLimit: number | null
  durationMinutes: number | null
  lead: string
  description: string[]
  credits: Credit[]
  posterUrl: string
  status: 'published' | 'draft'
}

export type Performance = {
  id: string
  showSlug: string
  venueId: string
  /** ISO 8601 со смещением театра, например 2026-10-20T19:00:00+05:00 */
  startsAt: string
  /** Пусто — продажи на сайте ещё не открыты. */
  ticketTypes: TicketType[]
}

export type ShowsData = {
  venues: Venue[]
  shows: Show[]
  performances: Performance[]
}

export type PerformanceView = {
  id: string
  startsAt: string
  show: Pick<Show, 'slug' | 'title' | 'ageLimit' | 'genre'>
  venue: Venue
  minPriceKopecks: number | null
  salesOpen: boolean
}
