import { createHash, timingSafeEqual } from 'node:crypto'
import { request } from 'node:https'
import { rootCertificates } from 'node:tls'

import {
  PaymentProviderError,
  type CreatePaymentInput,
  type CreatedPayment,
  type NotificationRequest,
  type ParsedNotification,
  type PaymentProvider,
  type ProviderPayment,
  type ProviderPaymentStatus,
  type ProviderRefund,
  type RefundInput,
} from '../types'
import { RUSSIAN_TRUSTED_ROOT_CA } from './russian-trusted-root-ca'

/**
 * Интернет-эквайринг Т-Банка, API v2 (T-001, T-043…T-045). Документация:
 * https://developer.tbank.ru/eacq/api — методы Init, GetState, Cancel; подпись запросов и
 * уведомлений — `Token` (https://developer.tbank.ru/eacq/intro/developer/token).
 *
 * - Терминал должен быть ОДНОСТАДИЙНЫМ: успех — статус CONFIRMED. При двухстадийном платёж
 *   застрянет в AUTHORIZED (здесь это `pending`) и банк сам его отменит.
 * - `OrderId` = id нашего заказа (UUID, 36 символов — предел банка). По нему `getPayment`
 *   связывает платёж с заказом.
 * - Init не идемпотентен: повтор после таймаута создаёт второй платёж с тем же OrderId. Его
 *   страница оплаты покупателю не показывается и истекает сама — двойного списания нет.
 * - Возврат — Cancel с `ExternalRequestId` = ключ идемпотентности: повтор с тем же ключом
 *   возвращает текущее состояние, а не второй возврат. Поэтому `getRefund` не нужен.
 * - Чек 54-ФЗ (`Receipt`) не передаётся до решения T-002: терминал с обязательной онлайн-кассой
 *   отклонит Init.
 * - Уведомление банк считает доставленным только по ответу `200` с телом `OK`
 *   (`TBANK_NOTIFICATION_ACK`, маршрут webhook).
 */

export const TBANK_PROVIDER_ID = 'tbank'
export const TBANK_DEFAULT_API_URL = 'https://securepay.tinkoff.ru/v2'
export const TBANK_NOTIFICATION_ACK = 'OK'

/** Ответ банка: HTTP-статус и разобранное JSON-тело (null — не JSON). */
export type TbankTransport = (
  url: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<{ status: number; json: unknown }>

/**
 * Подпись: только скалярные параметры корневого объекта (вложенные объекты и массивы — нет)
 * плюс `Password`, сортировка по ключу, конкатенация значений, SHA-256 (hex).
 */
export function tbankToken(params: Record<string, unknown>, password: string): string {
  const pairs: [string, string][] = [['Password', password]]
  for (const [key, value] of Object.entries(params)) {
    if (key === 'Token' || value === null || value === undefined) continue
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
      continue
    pairs.push([key, String(value)])
  }
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return createHash('sha256')
    .update(pairs.map(([, value]) => value).join(''), 'utf8')
    .digest('hex')
}

const SUCCEEDED = new Set([
  'CONFIRMED',
  'REFUNDING',
  'ASYNC_REFUNDING',
  'PARTIAL_REFUNDED',
  'REFUNDED',
])
const CANCELED = new Set([
  'CANCELED',
  'DEADLINE_EXPIRED',
  'REJECTED',
  'AUTH_FAIL',
  'REVERSED',
  'PARTIAL_REVERSED',
])

/** Статус платежа Т-Банка → домен. Всё промежуточное (NEW, FORM_SHOWED, 3DS, AUTHORIZED…) — pending. */
export function tbankPaymentStatus(status: string): ProviderPaymentStatus {
  if (SUCCEEDED.has(status)) return 'succeeded'
  if (CANCELED.has(status)) return 'canceled'
  return 'pending'
}

/** Статус платежа в ответе Cancel → состояние возврата. */
function refundStatus(status: string): ProviderRefund['status'] {
  if (['REFUNDED', 'PARTIAL_REFUNDED', 'REVERSED', 'PARTIAL_REVERSED'].includes(status))
    return 'succeeded'
  if (status === 'REJECTED' || status === 'CANCELED') return 'canceled'
  return 'pending'
}

/** HTTPS к банку: стандартные корневые сертификаты + Минцифры, только для этих запросов. */
const BANK_CA = [...rootCertificates, RUSSIAN_TRUSTED_ROOT_CA]

export const httpsTransport: TbankTransport = (url, body, signal) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = request(
      url,
      {
        method: 'POST',
        ca: BANK_CA,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
        signal,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          let json: unknown = null
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {
            json = null
          }
          resolve({ status: res.statusCode ?? 0, json })
        })
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end(payload)
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown): string | null =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null

export function createTbankProvider({
  terminalKey,
  password,
  notificationUrl,
  apiUrl = TBANK_DEFAULT_API_URL,
  transport = httpsTransport,
}: {
  terminalKey: string
  password: string
  /** Полный адрес webhook: `<сайт>/api/payments/webhook/tbank`. */
  notificationUrl: string
  apiUrl?: string
  transport?: TbankTransport
}): PaymentProvider {
  if (!terminalKey || !password) throw new Error('tbank terminal key and password are required')
  const base = apiUrl.replace(/\/+$/, '')

  /** Подписанный вызов метода. Сеть/5xx — unavailable; ответ без Success — rejected. */
  async function call(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const body = { TerminalKey: terminalKey, ...params }
    let response
    try {
      response = await transport(
        `${base}/${method}`,
        { ...body, Token: tbankToken(body, password) },
        signal,
      )
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
        throw new PaymentProviderError('timeout', `tbank ${method} timeout`)
      throw new PaymentProviderError('unavailable', `tbank ${method} network error`)
    }
    if (response.status >= 500 || response.status === 429 || !isRecord(response.json))
      throw new PaymentProviderError('unavailable', `tbank ${method} http ${response.status}`)
    const json = response.json
    if (json.Success !== true)
      // Только код ошибки: в Message/Details банк может вернуть данные платежа.
      throw new PaymentProviderError(
        'rejected',
        `tbank ${method} error ${str(json.ErrorCode) ?? '?'}`,
      )
    return json
  }

  return {
    id: TBANK_PROVIDER_ID,

    async createPayment(input: CreatePaymentInput, signal?: AbortSignal): Promise<CreatedPayment> {
      const json = await call(
        'Init',
        {
          Amount: input.amountKopecks,
          OrderId: input.orderId,
          Description: input.description.slice(0, 140),
          SuccessURL: input.returnUrl,
          FailURL: input.returnUrl,
          NotificationURL: notificationUrl,
        },
        signal,
      )
      const paymentId = str(json.PaymentId)
      if (!paymentId) throw new PaymentProviderError('rejected', 'tbank Init without PaymentId')
      const status = tbankPaymentStatus(str(json.Status) ?? '')
      return {
        providerPaymentId: paymentId,
        status,
        confirmationUrl: status === 'pending' ? str(json.PaymentURL) : null,
      }
    },

    async getPayment(providerPaymentId: string, signal?: AbortSignal): Promise<ProviderPayment> {
      const json = await call('GetState', { PaymentId: providerPaymentId }, signal)
      const amount = Number(json.Amount)
      return {
        providerPaymentId: str(json.PaymentId) ?? providerPaymentId,
        orderId: str(json.OrderId),
        status: tbankPaymentStatus(str(json.Status) ?? ''),
        // Нечисловая сумма не совпадёт с заказом — оплата не подтвердится.
        amountKopecks: Number.isSafeInteger(amount) ? amount : -1,
        currency: 'RUB',
      }
    },

    async refund(input: RefundInput, signal?: AbortSignal): Promise<ProviderRefund> {
      const json = await call(
        'Cancel',
        {
          PaymentId: input.providerPaymentId,
          Amount: input.amountKopecks,
          ExternalRequestId: input.idempotencyKey.slice(0, 255),
        },
        signal,
      )
      return {
        providerRefundId: `${input.providerPaymentId}:${input.idempotencyKey}`,
        status: refundStatus(str(json.Status) ?? ''),
        amountKopecks: input.amountKopecks,
      }
    },

    async parseNotification({ rawBody }: NotificationRequest): Promise<ParsedNotification> {
      let body: unknown
      try {
        body = JSON.parse(rawBody)
      } catch {
        return { ok: false, error: 'MALFORMED' }
      }
      if (!isRecord(body) || typeof body.Token !== 'string')
        return { ok: false, error: 'MALFORMED' }
      const expected = Buffer.from(tbankToken(body, password), 'utf8')
      const given = Buffer.from(body.Token.toLowerCase(), 'utf8')
      if (
        body.TerminalKey !== terminalKey ||
        expected.length !== given.length ||
        !timingSafeEqual(expected, given)
      )
        return { ok: false, error: 'UNAUTHENTICATED' }
      // Уведомления о привязке карты и прочие — не про оплату заказа.
      if (typeof body.NotificationType === 'string' && body.NotificationType !== 'PAYMENT')
        return { ok: true, ignored: true, eventType: body.NotificationType }
      const paymentId = str(body.PaymentId)
      const status = str(body.Status)
      if (!paymentId || !status) return { ok: false, error: 'MALFORMED' }
      return {
        ok: true,
        // Банк повторяет ту же доставку до ответа OK — один id на пару платёж+статус.
        eventId: `${paymentId}:${status}`,
        eventType: status,
        providerPaymentId: paymentId,
      }
    },
  }
}
