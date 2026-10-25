import type { NextRequest } from 'next/server'

import { apiError, withCorrelation } from '@/lib/correlation'
import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'
import { getTickets, qrPng, qrSvg } from '@/modules/tickets'

export const dynamic = 'force-dynamic'

const SIGNATURE = /^[A-Za-z0-9_-]{32}$/

// Картинка билета — не для кеша прокси и не для чужого Referer (в адресе бывает подпись).
const IMAGE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
}

/**
 * GET /api/tickets/<номер>/qr?format=png|svg[&sig=…] — QR-код билета (T-046). В картинке —
 * только токен билета (без ПД). Доступ: владелец по сессии кабинета или подписанная ссылка из
 * письма (`sig`). Чужой, несуществующий номер и неверная подпись неразличимы — 404.
 * Ответы: 200 image/png | image/svg+xml; 400 `invalid_input`; 401 `unauthorized` (нет сессии
 * и подписи); 404 `not_found`; 410 `ticket_invalid` (возвращён / в возврате / заказ не оплачен);
 * 503 `unavailable`.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params
  return withCorrelation('tickets.qr', async (request: NextRequest, ctx) => {
    const format = request.nextUrl.searchParams.get('format') ?? 'png'
    const sig = request.nextUrl.searchParams.get('sig')
    if ((format !== 'png' && format !== 'svg') || (sig !== null && !SIGNATURE.test(sig)))
      return apiError(400, 'invalid_input', 'Неверный запрос.', ctx.correlationId)

    let access
    try {
      let customerId: string | null = null
      if (!sig) {
        const { auth } = await getAccounts()
        const session = await auth.getSession(request.cookies.get(SESSION_COOKIE)?.value)
        if (!session)
          return apiError(401, 'unauthorized', 'Войдите в личный кабинет.', ctx.correlationId)
        customerId = session.customer.id
      }
      access = await (await getTickets()).qrFor({ number, customerId, signature: sig })
    } catch (error) {
      ctx.log.error('tickets.qr_unavailable', { error })
      return apiError(503, 'unavailable', 'Сервис временно недоступен.', ctx.correlationId)
    }

    if (!access.ok && access.reason === 'not_found')
      return apiError(404, 'not_found', 'Билет не найден.', ctx.correlationId)
    if (!access.ok)
      return apiError(410, 'ticket_invalid', 'Билет недействителен.', ctx.correlationId, {
        'X-Ticket-State': access.state,
      })

    if (format === 'svg')
      return new Response(qrSvg(access.token, `QR-код билета ${access.number}`), {
        headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', ...IMAGE_HEADERS },
      })
    return new Response(new Uint8Array(qrPng(access.token, 10)), {
      headers: { 'Content-Type': 'image/png', ...IMAGE_HEADERS },
    })
  })(req)
}
