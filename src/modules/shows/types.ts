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
  /** Цена-заглушка до утверждения театром: в интерфейсе помечается как предварительная. */
  placeholder?: boolean
}

export type CreditEntry = {
  /** Персонаж (для актёров), например «Габи». */
  character?: string
  /** Имена; несколько — состав в очередь (играют попеременно). */
  people: string[]
}

export type Credit = {
  role: string
  entries: CreditEntry[]
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
  /** Фото спектакля (не афиши) для баннера, коллажа и галереи. */
  gallery: string[]
  posterUrl: string
  status: 'published' | 'draft'
}

export type Performance = {
  id: string
  showSlug: string
  venueId: string
  /** ISO 8601 со смещением театра, например 2026-10-20T19:00:00+05:00 */
  startsAt: string
  /** Пусто — продажи на сайте ещё не открыты (для площадок без схемы зала). */
  ticketTypes: TicketType[]
  /** Продажа по местам на схеме зала (Дом актёра). Без цен категорий места не продаются. */
  seating?: {
    planId: string
    pricesKopecks: Record<string, number>
    /** Цены-заглушки до утверждения театром. */
    pricesPlaceholder?: boolean
    unavailableSeatIds: string[]
  }
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
  /** Хотя бы одна цена — заглушка, не утверждённая театром. */
  pricePlaceholder: boolean
  salesOpen: boolean
}
