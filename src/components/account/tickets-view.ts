import { THEATRE_TIME_ZONE } from '@/modules/shows'
import type { AccountTickets, OrderView, TicketState, TicketView } from '@/modules/tickets'

/**
 * «Мои билеты» (T-051): подписи и форматирование ответа `/api/account/tickets`. Без React —
 * покрыто тестами. Состояния билета приходят с сервера (ACCOUNT-04), здесь только текст.
 */
export type { AccountTickets, OrderView, TicketState, TicketView }

export const TICKET_STATE_LABELS: Record<TicketState, string> = {
  valid: 'Действует',
  refund_pending: 'Возврат обрабатывается',
  refunded: 'Возвращён',
  cancelled: 'Недействителен',
}

export const TICKET_STATE_HINTS: Record<TicketState, string | null> = {
  valid: null,
  refund_pending: 'Банк ещё не подтвердил возврат. QR-код на это время скрыт.',
  refunded: 'Деньги возвращены, билет больше не действует.',
  cancelled: 'Заказ не оплачен или на проверке у театра. По этому билету пройти нельзя.',
}

export const ORDER_STATUS_LABELS: Partial<Record<OrderView['status'], string>> = {
  PAID: 'Оплачен',
  PARTIALLY_REFUNDED: 'Частично возвращён',
  REFUNDED: 'Возвращён',
  NEEDS_REVIEW: 'На проверке у театра',
}

export const orderStatusLabel = (status: OrderView['status']) =>
  ORDER_STATUS_LABELS[status] ?? 'Обрабатывается'

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: THEATRE_TIME_ZONE,
  day: 'numeric',
  month: 'long',
  weekday: 'short',
})
const timeFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: THEATRE_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
})

/** «20 ноября, пт» и «19:00 GMT+5» — время театра с поясом (design.md §5 «Кабинет»). */
export const formatTicketDate = (iso: string | null) => {
  if (!iso) return { date: 'Дата уточняется', time: null }
  const d = new Date(iso)
  return { date: dateFormat.format(d), time: timeFormat.format(d) }
}

export const ticketPlace = (t: Pick<TicketView, 'category' | 'seat'>) =>
  t.seat ? `${t.category} · ${t.seat}` : t.category

/** Можно ли сейчас показать QR: сервер отдал адрес картинки (билет действует, показ впереди). */
export const canShowQr = (t: Pick<TicketView, 'qrUrl'>) => t.qrUrl !== null

export const canAddToCalendar = (t: TicketView, now: Date) =>
  t.state === 'valid' &&
  t.startsAt !== null &&
  t.endsAt !== null &&
  Date.parse(t.endsAt) > now.getTime()

export const findOrder = (data: AccountTickets, t: Pick<TicketView, 'orderNumber'>) =>
  data.orders.find((o) => o.number === t.orderNumber) ?? null

/** Ссылка на карту по адресу площадки (Яндекс Карты, поиск). */
export const mapUrl = (address: string) =>
  `https://yandex.ru/maps/?text=${encodeURIComponent(address)}`
