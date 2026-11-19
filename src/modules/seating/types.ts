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
  /** Планировка со столами (`SeatingPlan.floor`): центр места в координатах плана. */
  x?: number
  y?: number
}

export type SeatBlock = {
  section: 'left' | 'center' | 'right'
  seats: Seat[]
  /** Ширина блока в позициях, если места стоят не подряд (см. `Seat.col`). */
  width?: number
}

export type SeatRow = {
  number: number
  blocks: SeatBlock[]
  /** Подпись вместо «Ряд N»: «Стол 8», «Барная стойка». */
  label?: string
}

/** Стол на планировке; `row` — «ряд» схемы с местами этого стола. */
export type FloorTable = {
  row: number
  label: string
  shape: 'rect' | 'round'
  x: number
  y: number
  w: number
  h: number
  rotate?: number
}

/**
 * Свободная планировка (бар, лофт): помещение, столы, стойки, колонны и сцена в координатах
 * viewBox `0 0 width height`. Места — `Seat.x/y`. Рисуется вместо рядов.
 */
export type FloorPlan = {
  width: number
  height: number
  /** Контур помещения — SVG path. */
  outline: string
  tables: FloorTable[]
  bars: { path: string; iconX: number; iconY: number }[]
  columns: { x: number; y: number; r: number }[]
  stage: { x: number; y: number; w: number; h: number }
}

export type SeatingPlan = {
  id: string
  version: number
  venueId: string
  title: string
  categories: SeatCategory[]
  rows: SeatRow[]
  /** Планировка со столами вместо рядов. */
  floor?: FloorPlan
  /** Места, закрытые с продажи по умолчанию при выборе схемы для показа (включаются в админке). */
  defaultClosedSeatIds?: string[]
}

/** Продажа мест конкретного показа. Цена задаётся по категории; без цены категория не продаётся. */
export type PerformanceSeating = {
  plan: SeatingPlan
  pricesKopecks: Record<string, number>
  /** Цены — заглушка, не утверждённая театром; в интерфейсе помечаются. */
  pricesPlaceholder: boolean
  unavailableSeatIds: string[]
}
