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
  /**
   * Занято (продано + в брони). На сервере с базой — из ядра продаж (`applyStock`), в демо-наборе
   * и на статическом превью — демо-значение для показа индикаторов.
   */
  sold?: number
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

export type EventType = 'spectacle' | 'immersive' | 'performance' | 'concert' | 'promenade'

export type Show = {
  slug: string
  title: string
  genre: string | null
  ageLimit: number | null
  durationMinutes: number | null
  lead: string
  description: string[]
  credits: Credit[]
  eventType: EventType
  /** Премьера — по пометке театра. */
  premiere?: boolean
  /**
   * Дата анонса (YYYY-MM-DD) — чем новее, тем раньше спектакль в слайдере главной.
   * В CMS — дата создания записи.
   */
  announcedAt?: string
  /** Можно купить по Пушкинской карте — подтверждает театр. */
  pushkinCard?: boolean
  /** Есть студенческие условия (скидка, места по студенческому). Подтверждает театр. */
  studentOffer?: boolean
  /** Фото спектакля (не афиши) для баннера, коллажа и галереи. */
  gallery: string[]
  posterUrl: string
  /** Обложка наверху страницы спектакля; нет — первое фото галереи, иначе афиша. */
  coverUrl?: string
  /** Точка фокуса обложки (CSS object-position), если главное не в центре кадра. */
  coverFocus?: string
  /** Превью для карточек (368×250); нет — карточка берёт афишу `posterUrl`. */
  previewUrl?: string
  /** SEO из CMS; нет — заголовок и анонс спектакля. */
  seo?: { title?: string; description?: string; imageUrl?: string }
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
  /** Окно продаж (CMS): до начала окна и после конца — продажи на сайте закрыты. */
  salesStartsAt?: string
  salesEndsAt?: string
}

/** Прошедшая постановка (архив сайта театра): без показов и продаж, только состав. */
export type ArchivedShow = {
  slug: string
  title: string
  genre: string | null
  posterUrl: string
  credits: Credit[]
}

export type ShowsData = {
  venues: Venue[]
  shows: Show[]
  performances: Performance[]
  archive?: ArchivedShow[]
}

export type AvailabilityLevel = 'many' | 'few' | 'none'

/** Остаток на сайте: квоты и схема зала минус занятое (`applyStock`, на превью — демо). */
export type Availability = {
  available: number
  capacity: number
  level: AvailabilityLevel
}

export type PerformanceView = {
  id: string
  startsAt: string
  show: Pick<Show, 'slug' | 'title' | 'ageLimit' | 'genre' | 'eventType' | 'announcedAt'> & {
    premiere: boolean
    pushkinCard: boolean
    studentOffer: boolean
    /** Превью: фото спектакля, если есть, иначе превью карточки, иначе афиша. */
    imageUrl: string
  }
  venue: Venue
  minPriceKopecks: number | null
  /** Хотя бы одна цена — заглушка, не утверждённая театром. */
  pricePlaceholder: boolean
  salesOpen: boolean
  /** null — продажа на сайте не открыта, остаток неизвестен. */
  availability: Availability | null
}
