import type { Seat, SeatBlock, SeatCategory, SeatingPlan } from './types'

/**
 * Ценовая раскладка зала: какие ценовые зоны есть и к какой зоне относится каждое место.
 * Геометрия (ряды, места, id мест) — из схемы в коде; раскладка задаётся в админке на показ
 * или сохраняется шаблоном площадки. Пустая раскладка — категории схемы «по рядам».
 */
export type SeatLayout = {
  categories?: SeatCategory[] | null
  /** id места → id зоны. Места без записи остаются в категории схемы. */
  seatCategories?: Record<string, string> | null
}

/** Зоны — «cat-1»…«cat-12»: те же ключи, что у категорий схем, и у каждой свой цвет. */
export const MAX_SEAT_ZONES = 12
export const SEAT_ZONE_IDS = Array.from({ length: MAX_SEAT_ZONES }, (_, i) => `cat-${i + 1}`)

export const SEAT_ZONE_COLORS: Record<string, string> = {
  'cat-1': '#e0600c',
  'cat-2': '#6b2a5b',
  'cat-3': '#7a479c',
  'cat-4': '#8771b8',
  'cat-5': '#0b70d6',
  'cat-6': '#24895a',
  'cat-7': '#7a860d',
  'cat-8': '#b5306b',
  'cat-9': '#0e8a8a',
  'cat-10': '#a0661a',
  'cat-11': '#4a5bb8',
  'cat-12': '#5c6470',
}

const isZoneId = (id: string) => SEAT_ZONE_IDS.includes(id)

/**
 * Схема с раскладкой показа. Зоны раскладки идут первыми (в её порядке); категории схемы, на
 * которых ещё остались места, добавляются следом — чтобы ни одно место не осталось без зоны.
 */
export const applySeatLayout = (plan: SeatingPlan, layout?: SeatLayout | null): SeatingPlan => {
  const custom = (layout?.categories ?? []).filter((c) => isZoneId(c.id))
  const overrides = layout?.seatCategories ?? {}
  if (custom.length === 0 && Object.keys(overrides).length === 0) return plan

  const known = new Map<string, SeatCategory>(plan.categories.map((c) => [c.id, c]))
  // Название — из раскладки, цвет схемы сохраняется.
  for (const c of custom) known.set(c.id, { ...known.get(c.id), ...c })
  const zoneOf = (seatId: string, fallback: string) => {
    const zone = overrides[seatId]
    return zone && known.has(zone) ? zone : fallback
  }

  const rows = plan.rows.map((row) => ({
    ...row,
    blocks: row.blocks.map((block) => ({
      ...block,
      seats: block.seats.map((seat) => ({ ...seat, categoryId: zoneOf(seat.id, seat.categoryId) })),
    })),
  }))
  const used = new Set(
    rows.flatMap((r) => r.blocks.flatMap((b) => b.seats.map((s) => s.categoryId))),
  )
  const customIds = new Set(custom.map((c) => c.id))
  const categories = [
    ...custom.map((c) => known.get(c.id)!),
    ...plan.categories.filter((c) => !customIds.has(c.id) && used.has(c.id)),
  ]
  return { ...plan, categories, rows }
}

/** Полная раскладка схемы (каждое место → зона) — для сохранения и сравнения. */
export const layoutOf = (
  plan: SeatingPlan,
): { categories: SeatCategory[]; seatCategories: Record<string, string> } => ({
  categories: plan.categories,
  seatCategories: Object.fromEntries(
    plan.rows.flatMap((r) => r.blocks.flatMap((b) => b.seats.map((s) => [s.id, s.categoryId]))),
  ),
})

/** Цвет категории/зоны: со схемы театра, иначе палитра зон. */
export const seatCategoryColor = (plan: SeatingPlan, categoryId: string): string =>
  plan.categories.find((c) => c.id === categoryId)?.color ??
  SEAT_ZONE_COLORS[categoryId] ??
  '#888888'

/** Позиции блока слева направо: место или пропуск (null) — для отрисовки схемы. */
export const blockSlots = (block: SeatBlock): (Seat | null)[] => {
  if (!block.seats.some((s) => s.col !== undefined)) return block.seats
  const width = block.width ?? Math.max(...block.seats.map((s) => s.col ?? 0))
  const byCol = new Map(block.seats.map((s) => [s.col, s]))
  return Array.from({ length: width }, (_, i) => byCol.get(i + 1) ?? null)
}

/** «Ряд 3, место 12» или «Стол 8, место 3» — по подписи ряда схемы. */
export const seatPlace = (plan: SeatingPlan, seat: Pick<Seat, 'row' | 'number'>): string => {
  const label = plan.rows.find((r) => r.number === seat.row)?.label
  return `${label ?? `Ряд ${seat.row}`}, место ${seat.number}`
}
