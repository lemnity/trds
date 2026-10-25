import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Токен билета (T-046, architecture.md §6 `commerce_tickets`, TICKETS-05). Содержимое QR — только
 * этот токен: HMAC-SHA256 от id и версии билета на серверном секрете, base64url (43 символа).
 * Ни почты, ни имени, ни номера заказа в нём нет; в базе — только SHA-256 токена (`token_hash`).
 *
 * Формула совпадает с `ticketToken` из `@/modules/orders` (там билет выпускается) — тест
 * tickets.test.ts сверяет обе реализации. Здесь своя копия, потому что worker собирается без
 * Payload и не тянет сервис заказов.
 */

/** Секрет QR-токенов: из PAYLOAD_SECRET с меткой 'turdus:ticket' (как в `@/modules/orders`). */
export const ticketSecretFrom = (payloadSecret: string) =>
  createHmac('sha256', payloadSecret).update('turdus:ticket').digest('hex')

export const ticketToken = (secret: string, ticket: { id: string; tokenVersion: number }) =>
  createHmac('sha256', secret)
    .update(`ticket:${ticket.id}:${ticket.tokenVersion}`)
    .digest('base64url')

export const hashTicketToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** Формат токена: ровно 32 байта HMAC в base64url. Всё прочее — не наш токен. */
export const TICKET_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/

/** Номер билета: номер заказа TRD-XXXXXXXX и порядковый номер (TRD-7K2M9QXA-01). */
export const TICKET_NUMBER_FORMAT = /^TRD-[0-9A-Z]{8}-\d{2,3}$/
export const ORDER_NUMBER_FORMAT = /^TRD-[0-9A-Z]{8}$/

/**
 * Подпись ссылки на QR из письма (`/api/tickets/<номер>/qr?sig=…`): открывает картинку без входа
 * в кабинет. Ключ — отдельная метка от секрета билетов, поэтому подпись ссылки не равна токену
 * входа. В подписи версия токена: перевыпуск токена (ротация) отзывает старые ссылки.
 */
const linkKey = (secret: string) =>
  createHmac('sha256', secret).update('turdus:ticket-link').digest()

export const signQrLink = (secret: string, ticket: { number: string; tokenVersion: number }) =>
  createHmac('sha256', linkKey(secret))
    .update(`qr-link:${ticket.number}:${ticket.tokenVersion}`)
    .digest('base64url')
    .slice(0, 32)

export const verifyQrLink = (
  secret: string,
  ticket: { number: string; tokenVersion: number },
  signature: string,
) => {
  const expected = Buffer.from(signQrLink(secret, ticket))
  const given = Buffer.from(signature)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Сравнение токена без утечки по времени (повторная проверка после поиска по хешу). */
export const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
