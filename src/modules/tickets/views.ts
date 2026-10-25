import type { OrderStatus } from '@/modules/checkout'

import { performanceEnd, seatLabel, type PerformanceLookup } from './performances'
import type { OrderRecord, TicketRecord } from './store'

/**
 * Ответ кабинета (`GET /api/account/tickets`, T-051) и чистые правила показа билета. Типы
 * используются и в браузере (components/account) — только `import type`.
 *
 * Действительность билета считается по серверным статусам (ACCOUNT-04):
 * - `valid` — билет выпущен, заказ оплачен (в том числе частично возвращён — по другим билетам);
 * - `refund_pending` — возврат запрошен, банк ещё не подтвердил: QR не показываем;
 * - `refunded` — деньги возвращены;
 * - `cancelled` — заказ не в оплаченном статусе (на ручной проверке, отменён): билет недействителен.
 */
export type TicketState = 'valid' | 'refund_pending' | 'refunded' | 'cancelled'

export type TicketView = {
  number: string
  orderNumber: string
  state: TicketState
  show: { title: string; slug: string } | null
  /** ISO; null — показ не найден в афише (снят с публикации). */
  startsAt: string | null
  endsAt: string | null
  durationMinutes: number | null
  venue: { title: string; address: string } | null
  category: string
  seat: string | null
  priceKopecks: number
  refundedAt: string | null
  /** Картинка QR (сессия владельца); null — билет недействителен или показ прошёл. */
  qrUrl: string | null
}

export type OrderView = {
  number: string
  status: OrderStatus
  createdAt: string
  paidAt: string | null
  grossKopecks: number
  bonusKopecks: number
  feeKopecks: number
  cashKopecks: number
  items: {
    title: string
    showTitle: string | null
    startsAt: string | null
    seat: string | null
    quantity: number
    unitPriceKopecks: number
    lineGrossKopecks: number
  }[]
  ticketNumbers: string[]
}

export type AccountTickets = {
  upcoming: TicketView[]
  past: TicketView[]
  refunded: TicketView[]
  orders: OrderView[]
}

const LIVE_ORDER: readonly OrderStatus[] = ['PAID', 'PARTIALLY_REFUNDED']

export const ticketState = (t: Pick<TicketRecord, 'status' | 'orderStatus'>): TicketState => {
  if (t.status === 'REFUNDED') return 'refunded'
  if (t.status === 'REFUND_PENDING') return 'refund_pending'
  return LIVE_ORDER.includes(t.orderStatus) ? 'valid' : 'cancelled'
}

export const qrPath = (number: string, format: 'svg' | 'png' = 'svg') =>
  `/api/tickets/${encodeURIComponent(number)}/qr?format=${format}`

export const toTicketView = (t: TicketRecord, lookup: PerformanceLookup, now: Date): TicketView => {
  const info = lookup(t.performanceId)
  const state = ticketState(t)
  const endsAt = info ? performanceEnd(info) : null
  const past = endsAt !== null && endsAt.getTime() <= now.getTime()
  return {
    number: t.number,
    orderNumber: t.orderNumber,
    state,
    show: info ? { title: info.showTitle, slug: info.showSlug } : null,
    startsAt: info?.startsAt ?? null,
    endsAt: endsAt?.toISOString() ?? null,
    durationMinutes: info?.durationMinutes ?? null,
    venue: info?.venue ?? null,
    category: t.categoryTitle,
    seat: seatLabel(t.seatId),
    priceKopecks: t.priceKopecks,
    refundedAt: t.refundedAt?.toISOString() ?? null,
    qrUrl: state === 'valid' && !past ? qrPath(t.number) : null,
  }
}

const byStart = (a: TicketView, b: TicketView) =>
  (a.startsAt ? Date.parse(a.startsAt) : Infinity) -
    (b.startsAt ? Date.parse(b.startsAt) : Infinity) || (a.number < b.number ? -1 : 1)

/**
 * Вкладки кабинета: будущие (ближайший первым), прошедшие (последний первым), возвраты и
 * недействительные. Показ, которого нет в афише, считается будущим — билет не прячется.
 */
export const groupTickets = (views: TicketView[], now: Date) => {
  const upcoming: TicketView[] = []
  const past: TicketView[] = []
  const refunded: TicketView[] = []
  for (const v of views) {
    if (v.state !== 'valid') refunded.push(v)
    else if (v.endsAt && Date.parse(v.endsAt) <= now.getTime()) past.push(v)
    else upcoming.push(v)
  }
  return {
    upcoming: upcoming.sort(byStart),
    past: past.sort((a, b) => byStart(b, a)),
    refunded: refunded.sort((a, b) => byStart(b, a)),
  }
}

export const toOrderView = (
  o: OrderRecord,
  tickets: TicketRecord[],
  lookup: PerformanceLookup,
): OrderView => ({
  number: o.number,
  status: o.status,
  createdAt: o.createdAt.toISOString(),
  paidAt: o.paidAt?.toISOString() ?? null,
  grossKopecks: o.grossKopecks,
  bonusKopecks: o.bonusKopecks,
  feeKopecks: o.feeKopecks,
  cashKopecks: o.cashKopecks,
  items: o.items.map((i) => {
    const info = lookup(i.performanceId)
    return {
      title: i.title,
      showTitle: info?.showTitle ?? null,
      startsAt: info?.startsAt ?? null,
      seat: seatLabel(i.seatId),
      quantity: i.quantity,
      unitPriceKopecks: i.unitPriceKopecks,
      lineGrossKopecks: i.lineGrossKopecks,
    }
  }),
  ticketNumbers: tickets.filter((t) => t.orderId === o.id).map((t) => t.number),
})
