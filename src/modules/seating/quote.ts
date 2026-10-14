import { MAX_TICKETS_PER_ORDER } from '@/modules/checkout'

import type { Seat, SeatingPlan } from './types'

export const seatsOf = (plan: SeatingPlan): Seat[] =>
  plan.rows.flatMap((row) => row.blocks.flatMap((block) => block.seats))

export type SeatQuoteError =
  | 'EMPTY_ORDER'
  | 'UNKNOWN_SEAT'
  | 'DUPLICATE_SEAT'
  | 'SEAT_UNAVAILABLE'
  | 'PRICE_NOT_SET'
  | 'TOO_MANY_TICKETS'

export type SeatQuote = {
  seats: Array<{ id: string; row: number; number: number; priceKopecks: number }>
  lines: Array<{
    categoryId: string
    title: string
    unitPriceKopecks: number
    quantity: number
    totalKopecks: number
  }>
  ticketCount: number
  totalKopecks: number
}

/**
 * Расчёт заказа по выбранным местам (SEAT-03): цена — по категории места на сервере,
 * клиент передаёт только идентификаторы мест. Окончательная занятость проверяется
 * атомарным резервом в БД (architecture.md, commerce_seat_inventory).
 */
export const quoteSeats = (
  plan: SeatingPlan,
  pricesKopecks: Record<string, number>,
  unavailable: ReadonlySet<string>,
  selectedIds: string[],
): { ok: true; quote: SeatQuote } | { ok: false; error: SeatQuoteError } => {
  if (selectedIds.length === 0) return { ok: false, error: 'EMPTY_ORDER' }
  if (new Set(selectedIds).size !== selectedIds.length)
    return { ok: false, error: 'DUPLICATE_SEAT' }
  if (selectedIds.length > MAX_TICKETS_PER_ORDER) return { ok: false, error: 'TOO_MANY_TICKETS' }

  const byId = new Map(seatsOf(plan).map((s) => [s.id, s]))
  const seats: SeatQuote['seats'] = []
  for (const id of selectedIds) {
    const seat = byId.get(id)
    if (!seat) return { ok: false, error: 'UNKNOWN_SEAT' }
    if (unavailable.has(id)) return { ok: false, error: 'SEAT_UNAVAILABLE' }
    const price = pricesKopecks[seat.categoryId]
    if (price === undefined || !Number.isSafeInteger(price))
      return { ok: false, error: 'PRICE_NOT_SET' }
    seats.push({ id, row: seat.row, number: seat.number, priceKopecks: price })
  }

  const lines: SeatQuote['lines'] = []
  for (const category of plan.categories) {
    const inCategory = seats.filter((s) => byId.get(s.id)?.categoryId === category.id)
    if (inCategory.length === 0) continue
    const unit = pricesKopecks[category.id]!
    lines.push({
      categoryId: category.id,
      title: category.title,
      unitPriceKopecks: unit,
      quantity: inCategory.length,
      totalKopecks: unit * inCategory.length,
    })
  }
  const totalKopecks = lines.reduce((sum, l) => sum + l.totalKopecks, 0)
  return { ok: true, quote: { seats, lines, ticketCount: seats.length, totalKopecks } }
}
