import type { NextRequest } from 'next/server'

import { apiError, withCorrelation } from '@/lib/correlation'
import { errorInfo } from '@/lib/log'
import { getPurchase } from '@/modules/orders'

import { clientIp } from '../../../auth/http'
import { noStore, readBody } from '../../../checkout/http'

export const dynamic = 'force-dynamic'

/** Уведомления банков — несколько килобайт; больше — не наше уведомление. */
const MAX_BODY_BYTES = 64 * 1024

type Params = { params: Promise<{ provider: string }> }

/**
 * POST /api/payments/webhook/<provider> — уведомление банка (T-045, rules.md §6).
 * Подлинность — по контракту провайдера (`parseNotification`); событие пишется с дедупликацией;
 * оплата подтверждается только ответом банка `getPayment` (сумма, валюта, заказ), затем
 * `confirmPayment`. Письма и прочие внешние эффекты — через outbox, поэтому ответ быстрый.
 * 200 — принято (в т.ч. дубль); 401 — подпись не сошлась; 400 — не разобрать; 404 — не наш
 * провайдер; 413; 503 — банк/база недоступны, банк повторит доставку.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { provider } = await params
  return withCorrelation('payments.webhook', async (request: NextRequest, ctx) => {
    if (!/^[a-z0-9-]{1,32}$/.test(provider))
      return apiError(404, 'not_found', 'Не найдено.', ctx.correlationId)
    const rawBody = await readBody(request, MAX_BODY_BYTES)
    if (rawBody === null)
      return apiError(413, 'too_large', 'Слишком большой запрос.', ctx.correlationId)
    let purchase
    try {
      purchase = await getPurchase()
    } catch (error) {
      ctx.log.error('payment.unavailable', { error: errorInfo(error) })
      return apiError(503, 'unavailable', 'Временно недоступно.', ctx.correlationId)
    }
    const result = await purchase.handleNotification(
      provider,
      { headers: request.headers, rawBody, remoteIp: clientIp(request) },
      ctx.correlationId,
    )
    if (result.status >= 400)
      return apiError(
        result.status,
        String(result.body.code),
        'Уведомление не принято.',
        ctx.correlationId,
      )
    return noStore(result.body, result.status)
  })(req)
}
