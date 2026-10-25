import {
  PermanentOutboxError,
  needsReviewEmail,
  refundEmail,
  ticketsEmail,
  type EmailProvider,
  type OutboxHandler,
} from '@/modules/email'
import { THEATRE_TIME_ZONE } from '@/modules/shows/queries'

import { seatLabel, type PerformanceLookup } from './performances'
import { qrPng } from './qr'
import type { TicketsService } from './service'
import type { TicketsStore } from './store'
import { ticketState } from './views'

/**
 * Письма по событиям outbox (T-047): что отправить на `order.paid`, `order.needs_review`,
 * `refund.succeeded`. В payload события ПД нет (`{orderId, orderNumber}` / `{refundId}`) — почта
 * получателя и состав заказа читаются из БД в момент отправки. Обработчик только читает и
 * отправляет: статусы заказа и билетов не меняет (сбой почты не трогает оплату).
 */

/** Виды событий, которые обрабатывает почта. Остальные виды outbox (автовозврат и т.п.) — не наши. */
export const EMAIL_EVENT_KINDS = {
  orderPaid: 'order.paid',
  orderNeedsReview: 'order.needs_review',
  refundSucceeded: 'refund.succeeded',
} as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const idFrom = (value: unknown, fallback: string) => {
  const id = typeof value === 'string' ? value : fallback
  if (!UUID.test(id)) throw new PermanentOutboxError('BAD_PAYLOAD')
  return id
}

const whenFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: THEATRE_TIME_ZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
})

/** «20 ноября 2026 г., пт, 19:00 GMT+5» — время театра с поясом (design.md §5 «Кабинет»). */
export const formatShowTime = (iso: string) => whenFormat.format(new Date(iso))

export function ticketNotificationHandlers({
  store,
  tickets,
  performances,
  provider,
  siteUrl,
  theatreEmail,
}: {
  store: TicketsStore
  tickets: Pick<TicketsService, 'qrLink' | 'tokenOf'>
  performances: () => PerformanceLookup | Promise<PerformanceLookup>
  provider: EmailProvider
  siteUrl: string
  /** Адрес театра для ручной проверки; не задан — событие ждёт в очереди (и сигналит монитор). */
  theatreEmail: string | null
}): Record<string, OutboxHandler> {
  const accountUrl = `${siteUrl}/account#tickets`

  const orderPaid: OutboxHandler = async (item) => {
    const notice = await store.orderForNotice(idFrom(item.payload.orderId, item.aggregateId))
    if (!notice) throw new PermanentOutboxError('ORDER_NOT_FOUND')
    const lookup = await performances()
    // Билет вернули раньше, чем ушло письмо, — отправлять нечего (событие завершается).
    const live = notice.tickets.filter((t) => ticketState(t) === 'valid')
    if (!live.length) return
    const lines = live.map((t) => {
      const info = lookup(t.performanceId)
      return {
        number: t.number,
        showTitle: info?.showTitle ?? null,
        when: info ? formatShowTime(info.startsAt) : null,
        venue: info?.venue ?? null,
        category: t.categoryTitle,
        seat: seatLabel(t.seatId),
        qrPng: qrPng(tickets.tokenOf(t), 6),
        qrLink: tickets.qrLink(siteUrl, t),
      }
    })
    await provider.send({
      to: notice.email,
      ...ticketsEmail({
        orderNumber: notice.number,
        tickets: lines,
        amounts: {
          grossKopecks: notice.grossKopecks,
          bonusKopecks: notice.bonusKopecks,
          feeKopecks: notice.feeKopecks,
          cashKopecks: notice.cashKopecks,
        },
        accountUrl,
      }),
      idempotencyKey: item.dedupeKey,
    })
  }

  const refundSucceeded: OutboxHandler = async (item) => {
    const refund = await store.refundForNotice(idFrom(item.payload.refundId, item.aggregateId))
    if (!refund) throw new PermanentOutboxError('REFUND_NOT_FOUND')
    await provider.send({
      to: refund.order.email,
      ...refundEmail({
        orderNumber: refund.order.number,
        ticketNumbers: refund.ticketNumbers,
        cashKopecks: refund.cashKopecks,
        bonusKopecks: refund.bonusKopecks,
        completed: refund.status === 'SUCCEEDED',
        accountUrl,
      }),
      idempotencyKey: item.dedupeKey,
    })
  }

  const handlers: Record<string, OutboxHandler> = {
    [EMAIL_EVENT_KINDS.orderPaid]: orderPaid,
    [EMAIL_EVENT_KINDS.refundSucceeded]: refundSucceeded,
  }
  if (theatreEmail)
    handlers[EMAIL_EVENT_KINDS.orderNeedsReview] = async (item) => {
      const notice = await store.orderForNotice(idFrom(item.payload.orderId, item.aggregateId))
      if (!notice) throw new PermanentOutboxError('ORDER_NOT_FOUND')
      await provider.send({
        to: theatreEmail,
        ...needsReviewEmail({
          orderNumber: notice.number,
          reason: notice.reviewReason,
          adminUrl: `${siteUrl}/admin`,
        }),
        idempotencyKey: item.dedupeKey,
      })
    }
  return handlers
}
