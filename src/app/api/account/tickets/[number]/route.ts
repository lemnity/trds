import type { NextRequest } from 'next/server'

import { apiError, withCorrelation } from '@/lib/correlation'
import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'
import { getTickets } from '@/modules/tickets'

export const dynamic = 'force-dynamic'

/**
 * GET /api/account/tickets/<номер> — билет покупателя и его заказ (позиции, суммы, оплачено
 * бонусами, статус). Ответ 200 `{ ticket: TicketView, order: OrderView | null }`;
 * 401 `unauthorized`; 404 `not_found` — и для чужого билета (не раскрываем, что он существует);
 * 503 `unavailable`.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params
  return withCorrelation('account.ticket', async (request: NextRequest, ctx) => {
    try {
      const { auth } = await getAccounts()
      const session = await auth.getSession(request.cookies.get(SESSION_COOKIE)?.value)
      if (!session)
        return apiError(401, 'unauthorized', 'Войдите в личный кабинет.', ctx.correlationId)
      const found = await (
        await getTickets()
      ).ticketForCustomer(session.customer.id, number, new Date())
      if (!found) return apiError(404, 'not_found', 'Билет не найден.', ctx.correlationId)
      return Response.json(found, { headers: { 'Cache-Control': 'private, no-store' } })
    } catch (error) {
      ctx.log.error('account.ticket_unavailable', { error })
      return apiError(503, 'unavailable', 'Билет временно недоступен.', ctx.correlationId)
    }
  })(req)
}
