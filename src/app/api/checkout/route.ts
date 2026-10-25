import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { apiError, withCorrelation } from '@/lib/correlation'
import { errorInfo } from '@/lib/log'
import { createRateLimiter } from '@/lib/rate-limit'
import { MAX_TICKETS_PER_ORDER, parseContact } from '@/modules/checkout'
import { PaymentConfigError, getPurchase, type CheckoutError } from '@/modules/orders'
import { findPerformance } from '@/modules/shows'
import { loadShowsData } from '@/modules/site-data'

import { clientIp, sameOrigin } from '../auth/http'
import { noStore, readBody, sessionCustomerId, siteOrigin } from './http'

export const dynamic = 'force-dynamic'

// Оформление — несколько попыток на покупку; потолок с одного адреса не даёт занять зал бронями.
const byIp = createRateLimiter({ limit: 20, windowMs: 10 * 60_000 })
const MAX_BODY_BYTES = 8 * 1024

const ID = /^[a-z0-9-]{1,100}$/
const requestSchema = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9-]{16,100}$/),
  performanceId: z.string().regex(ID),
  selection: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('tickets'),
      quantities: z.record(
        z.string().regex(ID),
        z.number().int().min(0).max(MAX_TICKETS_PER_ORDER),
      ),
    }),
    z.object({
      kind: z.literal('seats'),
      seatIds: z.array(z.string().regex(ID)).min(1).max(MAX_TICKETS_PER_ORDER),
    }),
  ]),
  contact: z.unknown(),
  /** Желаемое списание бонусов; итог посчитает сервер (applyBonus по балансу из базы). */
  bonusKopecks: z.number().int().min(0).max(100_000_000_000).default(0),
})

const ERRORS: Record<CheckoutError, [number, string, string]> = {
  PAYMENT_UNAVAILABLE: [503, 'payment_unavailable', 'Оплата на сайте ещё не подключена.'],
  PRICES_NOT_APPROVED: [503, 'payment_unavailable', 'Продажа на этот показ ещё не открыта.'],
  INVALID_KEY: [400, 'invalid', 'Проверьте заказ и попробуйте ещё раз.'],
  INVALID_SELECTION: [400, 'invalid_selection', 'Выбор билетов устарел — выберите заново.'],
  UNAVAILABLE: [409, 'unavailable', 'Эти места уже заняты — выберите другие.'],
  IDEMPOTENCY_CONFLICT: [409, 'idempotency_conflict', 'Заказ изменился — отправьте ещё раз.'],
  ORDER_CLOSED: [409, 'order_closed', 'Бронь истекла — оформите заказ заново.'],
  BONUS_CHANGED: [409, 'bonus_changed', 'Бонусный баланс изменился — проверьте сумму.'],
  PAYMENT_FAILED: [502, 'payment_failed', 'Банк не принял платёж. Деньги не списаны.'],
  PAYMENT_RETRY: [
    503,
    'payment_retry',
    'Банк не ответил вовремя. Повторите — второго платежа не будет.',
  ],
}

/**
 * POST /api/checkout — бронь и платёж (T-044, architecture.md §9, §11).
 * Тело: `{ idempotencyKey, performanceId, selection, contact, bonusKopecks }` — только выбор
 * и пожелание по бонусам; цены, сбор, списание и сумму сервер считает сам по данным показа.
 * 200 `{ ok, orderId, orderNumber, status, amountKopecks, holdUntil, redirectUrl, replay }` —
 * перейти на `redirectUrl` (страница банка или результата). Ошибки — `{ code, message,
 * correlationId }`: 400 invalid/invalid_contact/invalid_selection/method_unavailable,
 * 403 forbidden, 404 performance_unavailable, 409 unavailable/idempotency_conflict/order_closed/
 * bonus_changed, 413, 429, 502 payment_failed, 503 payment_unavailable/payment_retry.
 */
export const POST = withCorrelation('checkout.create', async (req: NextRequest, ctx) => {
  const fail = (status: number, code: string, message: string, headers?: Record<string, string>) =>
    apiError(status, code, message, ctx.correlationId, headers)
  if (!sameOrigin(req)) return fail(403, 'forbidden', 'Запрос не с сайта театра.')
  if (!byIp.hit(clientIp(req)))
    return fail(429, 'too_many', 'Слишком много попыток. Подождите несколько минут.', {
      'Retry-After': '600',
    })
  const text = await readBody(req, MAX_BODY_BYTES)
  if (text === null) return fail(413, 'too_large', 'Слишком большой запрос.')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return fail(400, 'invalid', 'Проверьте заказ и попробуйте ещё раз.')
  }
  const parsed = requestSchema.safeParse(raw)
  if (!parsed.success) return fail(400, 'invalid', 'Проверьте заказ и попробуйте ещё раз.')
  const contact = parseContact(parsed.data.contact)
  if (!contact.ok)
    return Response.json(
      {
        code: 'invalid_contact',
        message: 'Проверьте данные покупателя.',
        fields: contact.errors,
        correlationId: ctx.correlationId,
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  const method = contact.contact.payment
  if (method === 'boxoffice')
    return fail(400, 'method_unavailable', 'Оплата в кассе через сайт пока не подключена.')

  const performance = findPerformance(await loadShowsData(), parsed.data.performanceId, new Date())
  if (!performance) return fail(404, 'performance_unavailable', 'Продажа на этот показ закрыта.')

  let purchase
  try {
    purchase = await getPurchase()
  } catch (error) {
    // Неверная настройка провайдера — честно «оплата недоступна», подробности только в лог.
    ctx.log.error(
      error instanceof PaymentConfigError ? 'payment.config_invalid' : 'payment.unavailable',
      { error: errorInfo(error) },
    )
    return fail(503, 'payment_unavailable', 'Оплата на сайте временно недоступна.')
  }
  if (!purchase.available)
    return fail(503, 'payment_unavailable', 'Оплата на сайте ещё не подключена.')

  const result = await purchase.checkout({
    clientKey: parsed.data.idempotencyKey,
    performance,
    selection: parsed.data.selection,
    email: contact.contact.email,
    customerId: await sessionCustomerId(req),
    requestedBonusKopecks: parsed.data.bonusKopecks,
    method,
    siteOrigin: siteOrigin(req),
    correlationId: ctx.correlationId,
  })
  if (!result.ok) {
    const [status, code, message] = ERRORS[result.error]
    if (result.error !== 'UNAVAILABLE') ctx.log.info('checkout.rejected', { error: result.error })
    return fail(
      status,
      code,
      message,
      result.error === 'PAYMENT_RETRY' ? { 'Retry-After': '5' } : {},
    )
  }
  ctx.log.info('checkout.created', { orderId: result.orderId, replay: result.replay })
  return noStore({
    ok: true,
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    status: result.status,
    amountKopecks: result.amountKopecks,
    holdUntil: result.holdUntil?.toISOString() ?? null,
    redirectUrl: result.redirectUrl,
    replay: result.replay,
  })
})
