export type SeatCategory = {
  id: string
  title: string
  /** Цвет категории со схемы театра; нет — цвет зоны по ключу (SEAT_ZONE_COLORS). */
  color?: string
}

export type Seat = {
  /** Стабильный идентификатор в пределах версии схемы: r<ряд>-s<место>. */
  id: string
  row: number
  number: number
  categoryId: string
  /** Позиция в блоке (с 1), если в блоке есть пропуски — «места нет» на схеме. */
  col?: number
}

export type SeatBlock = {
  section: 'left' | 'center' | 'right'
  seats: Seat[]
  /** Ширина блока в позициях, если места стоят не подряд (см. `Seat.col`). */
  width?: number
}

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
