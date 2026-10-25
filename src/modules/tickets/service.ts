import type { PerformanceLookup } from './performances'
import type { TicketRecord, TicketsStore } from './store'
import {
  TICKET_NUMBER_FORMAT,
  TICKET_TOKEN_FORMAT,
  hashTicketToken,
  sameToken,
  signQrLink,
  ticketToken,
  verifyQrLink,
} from './token'
import {
  groupTickets,
  ticketState,
  toOrderView,
  toTicketView,
  type AccountTickets,
  type OrderView,
  type TicketState,
  type TicketView,
} from './views'

/**
 * Билеты для зрителя (T-046, T-051). Доступ: каждый метод кабинета принимает customerId только
 * из серверной сессии (rules.md §4) и отдаёт лишь билеты заказов этого покупателя; чужой или
 * несуществующий номер неразличимы (null → 404).
 */

export type QrAccess =
  | { ok: true; token: string; number: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid'; state: TicketState }

/**
 * Результат проверки токена со сканера на входе (будущий check-in, вне MVP — ADR-006).
 * Без ПД: номер билета, показ и место.
 */
export type TokenCheck =
  | { ok: false; reason: 'malformed' | 'unknown' }
  | {
      ok: true
      valid: boolean
      state: TicketState
      ticket: {
        number: string
        performanceId: string
        ticketTypeId: string
        seatId: string | null
        startsAt: string | null
      }
    }

type Deps = {
  store: TicketsStore
  /** Секрет QR-токенов (`ticketSecretFrom(PAYLOAD_SECRET)`). */
  secret: string
  /** Данные показов; функция — чтобы источник афиши можно было обновлять без перезапуска. */
  performances: () => PerformanceLookup | Promise<PerformanceLookup>
}

export function createTicketsService({ store, secret, performances }: Deps) {
  if (!secret) throw new Error('ticket secret is required')

  const tokenOf = (t: Pick<TicketRecord, 'id' | 'tokenVersion'>) => ticketToken(secret, t)

  /** Все билеты и заказы покупателя, разложенные по вкладкам кабинета. */
  async function accountTickets(customerId: string, now: Date): Promise<AccountTickets> {
    const [tickets, orders, lookup] = await Promise.all([
      store.ticketsOfCustomer(customerId),
      store.ordersOfCustomer(customerId),
      performances(),
    ])
    // Двойная проверка владельца: хранилище уже фильтрует, но ошибка запроса не должна отдать чужое.
    const own = tickets.filter((t) => t.customerId === customerId)
    return {
      ...groupTickets(
        own.map((t) => toTicketView(t, lookup, now)),
        now,
      ),
      orders: orders
        .filter((o) => o.customerId === customerId)
        .reverse()
        .map((o) => toOrderView(o, own, lookup)),
    }
  }

  /** Один билет покупателя с его заказом; чужой — null. */
  async function ticketForCustomer(
    customerId: string,
    number: string,
    now: Date,
  ): Promise<{ ticket: TicketView; order: OrderView | null } | null> {
    if (!TICKET_NUMBER_FORMAT.test(number)) return null
    const t = await store.ticketByNumber(number)
    if (!t || t.customerId !== customerId) return null
    const [orders, tickets, lookup] = await Promise.all([
      store.ordersOfCustomer(customerId),
      store.ticketsOfCustomer(customerId),
      performances(),
    ])
    const order = orders.find((o) => o.id === t.orderId)
    return {
      ticket: toTicketView(t, lookup, now),
      order: order ? toOrderView(order, tickets, lookup) : null,
    }
  }

  /**
   * Токен для картинки QR. Доступ — владелец по сессии или подписанная ссылка из письма.
   * Возвращённый/недействительный билет QR не получает.
   */
  async function qrFor(request: {
    number: string
    customerId?: string | null
    signature?: string | null
  }): Promise<QrAccess> {
    if (!TICKET_NUMBER_FORMAT.test(request.number)) return { ok: false, reason: 'not_found' }
    const t = await store.ticketByNumber(request.number)
    if (!t) return { ok: false, reason: 'not_found' }
    const allowed = request.signature
      ? verifyQrLink(secret, t, request.signature)
      : Boolean(request.customerId) && t.customerId === request.customerId
    if (!allowed) return { ok: false, reason: 'not_found' }
    const state = ticketState(t)
    if (state !== 'valid') return { ok: false, reason: 'invalid', state }
    return { ok: true, token: tokenOf(t), number: t.number }
  }

  /** Проверка токена с QR (для будущего сканера на входе): поиск по хешу и сверка HMAC. */
  async function verifyTicketToken(token: string): Promise<TokenCheck> {
    if (!TICKET_TOKEN_FORMAT.test(token)) return { ok: false, reason: 'malformed' }
    const t = await store.ticketByTokenHash(hashTicketToken(token))
    // Хеш совпал, но токен не наш (старый секрет/версия) — неизвестный билет.
    if (!t || !sameToken(tokenOf(t), token)) return { ok: false, reason: 'unknown' }
    const state = ticketState(t)
    const lookup = await performances()
    return {
      ok: true,
      valid: state === 'valid',
      state,
      ticket: {
        number: t.number,
        performanceId: t.performanceId,
        ticketTypeId: t.ticketTypeId,
        seatId: t.seatId,
        startsAt: lookup(t.performanceId)?.startsAt ?? null,
      },
    }
  }

  /** Ссылка на QR для письма: открывается без входа, только для этого билета и версии токена. */
  const qrLink = (siteUrl: string, t: Pick<TicketRecord, 'number' | 'tokenVersion'>) =>
    `${siteUrl.replace(/\/$/, '')}/api/tickets/${encodeURIComponent(t.number)}/qr?format=png&sig=${signQrLink(secret, t)}`

  return { accountTickets, ticketForCustomer, qrFor, verifyTicketToken, qrLink, tokenOf }
}

export type TicketsService = ReturnType<typeof createTicketsService>
