import type { TicketType } from '@/modules/shows'

export const MAX_TICKETS_PER_ORDER = 10

export type QuoteLine = {
  ticketTypeId: string
  title: string
  unitPriceKopecks: number
  quantity: number
  totalKopecks: number
}

export type Quote = {
  lines: QuoteLine[]
  ticketCount: number
  totalKopecks: number
}

export type QuoteError =
  'EMPTY_ORDER' | 'UNKNOWN_TICKET_TYPE' | 'INVALID_QUANTITY' | 'TOO_MANY_TICKETS'

/**
 * Единственный расчёт суммы заказа (architecture.md §7). Цены берутся из данных показа,
 * клиент передаёт только количества. Остаток в реальном времени проверяет inventory (T-042).
 */
export const quoteOrder = (
  ticketTypes: TicketType[],
  quantities: Record<string, number>,
): { ok: true; quote: Quote } | { ok: false; error: QuoteError } => {
  const lines: QuoteLine[] = []
  for (const [ticketTypeId, quantity] of Object.entries(quantities)) {
    const type = ticketTypes.find((t) => t.id === ticketTypeId)
    if (!type) return { ok: false, error: 'UNKNOWN_TICKET_TYPE' }
    if (!Number.isSafeInteger(quantity) || quantity < 0)
      return { ok: false, error: 'INVALID_QUANTITY' }
    if (quantity > type.capacity) return { ok: false, error: 'TOO_MANY_TICKETS' }
    if (quantity === 0) continue
    lines.push({
      ticketTypeId,
      title: type.title,
      unitPriceKopecks: type.priceKopecks,
      quantity,
      totalKopecks: type.priceKopecks * quantity,
    })
  }
  const ticketCount = lines.reduce((sum, l) => sum + l.quantity, 0)
  if (ticketCount === 0) return { ok: false, error: 'EMPTY_ORDER' }
  if (ticketCount > MAX_TICKETS_PER_ORDER) return { ok: false, error: 'TOO_MANY_TICKETS' }
  const totalKopecks = lines.reduce((sum, l) => sum + l.totalKopecks, 0)
  if (!Number.isSafeInteger(totalKopecks)) return { ok: false, error: 'INVALID_QUANTITY' }
  return { ok: true, quote: { lines, ticketCount, totalKopecks } }
}
