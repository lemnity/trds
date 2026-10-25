import { demoShowsData, type Performance, type ShowsData } from '@/modules/shows'

import type { AccountTickets, OrderView, TicketView } from './tickets-view'

/**
 * ДЕМО «Моих билетов» для статического превью (GitHub Pages, сервера нет): билеты на настоящие
 * показы из афиши превью, чтобы можно было посмотреть кабинет, QR и «В календарь». Это не билеты:
 * номера TRD-DEMO…, в QR — строка «DEMO», в интерфейсе плашка «Демо».
 */

const DEFAULT_DURATION_MINUTES = 180
const MINUTE = 60_000

const ticketFor = (
  data: ShowsData,
  p: Performance,
  n: number,
  state: TicketView['state'],
  orderNumber: string,
): TicketView => {
  const show = data.shows.find((s) => s.slug === p.showSlug)
  const venue = data.venues.find((v) => v.id === p.venueId)
  const duration = show?.durationMinutes ?? null
  const ends = new Date(Date.parse(p.startsAt) + (duration ?? DEFAULT_DURATION_MINUTES) * MINUTE)
  const type = p.ticketTypes[0]
  return {
    number: `${orderNumber}-${String(n).padStart(2, '0')}`,
    orderNumber,
    state,
    show: show ? { title: show.title, slug: show.slug } : null,
    startsAt: p.startsAt,
    endsAt: ends.toISOString(),
    durationMinutes: duration,
    venue: venue ? { title: venue.title, address: venue.address } : null,
    category: type?.title ?? 'Входной билет',
    seat: null,
    priceKopecks: type?.priceKopecks ?? 150_000,
    refundedAt:
      state === 'refunded'
        ? new Date(Date.parse(p.startsAt) - 7 * 1440 * MINUTE).toISOString()
        : null,
    // QR в демо рисуется в браузере (useAccountTickets), адрес картинки не нужен.
    qrUrl: null,
  }
}

const orderOf = (number: string, tickets: TicketView[], status: OrderView['status'], bonus = 0) => {
  const gross = tickets.reduce((sum, t) => sum + t.priceKopecks, 0)
  return {
    number,
    status,
    createdAt: new Date(Date.parse(tickets[0]!.startsAt!) - 14 * 1440 * MINUTE).toISOString(),
    paidAt: new Date(Date.parse(tickets[0]!.startsAt!) - 14 * 1440 * MINUTE).toISOString(),
    grossKopecks: gross,
    bonusKopecks: bonus,
    feeKopecks: 0,
    cashKopecks: gross - bonus,
    items: [
      {
        title: tickets[0]!.category,
        showTitle: tickets[0]!.show?.title ?? null,
        startsAt: tickets[0]!.startsAt,
        seat: null,
        quantity: tickets.length,
        unitPriceKopecks: tickets[0]!.priceKopecks,
        lineGrossKopecks: gross,
      },
    ],
    ticketNumbers: tickets.map((t) => t.number),
  } satisfies OrderView
}

/** Два билета на ближайший показ, один прошедший и один возвращённый — если такие показы есть. */
export function demoAccountTickets(now: Date, data: ShowsData = demoShowsData): AccountTickets {
  const published = new Set(data.shows.filter((s) => s.status === 'published').map((s) => s.slug))
  const sorted = data.performances
    .filter((p) => published.has(p.showSlug))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  const future = sorted.filter((p) => Date.parse(p.startsAt) > now.getTime())
  const past = sorted.filter(
    (p) => Date.parse(p.startsAt) + DEFAULT_DURATION_MINUTES * MINUTE < now.getTime(),
  )

  const result: AccountTickets = { upcoming: [], past: [], refunded: [], orders: [] }
  if (future[0]) {
    const tickets = [1, 2].map((n) => ticketFor(data, future[0]!, n, 'valid', 'TRD-DEMO0001'))
    result.upcoming.push(...tickets)
    // Часть заказа оплачена бонусами — как в демо бонусов (списание 60 ₽).
    result.orders.push(orderOf('TRD-DEMO0001', tickets, 'PAID', 6_000))
  }
  const last = past.at(-1)
  if (last) {
    const t = ticketFor(data, last, 1, 'valid', 'TRD-DEMO0002')
    result.past.push(t)
    result.orders.push(orderOf('TRD-DEMO0002', [t], 'PAID'))
  }
  const refundable = future[1] ?? future[0]
  if (refundable) {
    const t = ticketFor(data, refundable, 1, 'refunded', 'TRD-DEMO0003')
    result.refunded.push(t)
    result.orders.push(orderOf('TRD-DEMO0003', [t], 'REFUNDED'))
  }
  return result
}

/** Содержимое демо-QR: явно не токен билета. */
export const demoQrContent = (number: string) => `DEMO ${number} — не билет`
