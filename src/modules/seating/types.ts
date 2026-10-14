export type SeatCategory = { id: string; title: string }

export type Seat = {
  /** Стабильный идентификатор в пределах версии схемы: r<ряд>-s<место>. */
  id: string
  row: number
  number: number
  categoryId: string
}

export type SeatBlock = { section: 'left' | 'center' | 'right'; seats: Seat[] }

export type SeatRow = { number: number; blocks: SeatBlock[] }

export type SeatingPlan = {
  id: string
  version: number
  venueId: string
  title: string
  categories: SeatCategory[]
  rows: SeatRow[]
}

/** Продажа мест конкретного показа. Цена задаётся по категории; без цены категория не продаётся. */
export type PerformanceSeating = {
  plan: SeatingPlan
  pricesKopecks: Record<string, number>
  /** Цены — заглушка, не утверждённая театром; в интерфейсе помечаются. */
  pricesPlaceholder: boolean
  unavailableSeatIds: string[]
}
