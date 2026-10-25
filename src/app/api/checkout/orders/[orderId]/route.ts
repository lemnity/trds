import type { NextRequest } from 'next/server'

import { apiError, withCorrelation } from '@/lib/correlation'
import { sharedRateLimiter } from '@/lib/rate-limit'
import { getPurchase } from '@/modules/orders'

import { clientIp } from '../../../auth/http'
import { noStore, sessionCustomerId } from '../../http'

export const dynamic = 'force-dynamic'

// Страница результата опрашивает статус раз в несколько секунд; запас — на несколько вкладок.
const byIp = sharedRateLimiter({ name: 'checkout.status.ip', limit: 120, windowMs: 10 * 60_000 })

type Params = { params: Promise<{ orderId: string }> }

/**
 * GET /api/checkout/orders/<orderId>?token=… — статус заказа для страницы результата (T-044).
 * Доступ — подписанный `token` из адреса возврата или сессия владельца; иначе 404 (не раскрываем,
 * есть ли такой заказ). Статус — только из базы (ожидающий сверяется с банком server-to-server);
 * параметрам адреса возврата об оплате не верим.
 * 200 `{ orderId, orderNumber, status: pending|paid|refunded|failed|expired|review, amountKopecks,
 * ticketCount, holdUntil }`; 404 not_found; 429.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { orderId } = await params
  return withCorrelation('checkout.status', async (request: NextRequest, ctx) => {
    if (!(await byIp.hit(clientIp(request))))
      return apiError(429, 'too_many', 'Слишком много запросов.', ctx.correlationId)
    const purchase = await getPurchase()
    const view = await purchase.orderStatus(orderId, {
      token: request.nextUrl.searchParams.get('token'),
      customerId: await sessionCustomerId(request),
    })
    if (!view) return apiError(404, 'not_found', 'Заказ не найден.', ctx.correlationId)
    return noStore({ ...view, holdUntil: view.holdUntil?.toISOString() ?? null })
  })(req)
}
