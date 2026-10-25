import type { NextRequest } from 'next/server'

import { apiError, withCorrelation } from '@/lib/correlation'
import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'
import { getTickets } from '@/modules/tickets'

export const dynamic = 'force-dynamic'

/**
 * GET /api/account/tickets — «Мои билеты» (T-051): билеты и заказы покупателя из серверной
 * сессии (никакого customerId из запроса — ACCOUNT-02). Ответ 200 — `AccountTickets`
 * (`@/modules/tickets`): `{ upcoming, past, refunded, orders }`; 401 `unauthorized`;
 * 503 `unavailable`. Ошибки — `{code, message, correlationId}`.
 */
export const GET = withCorrelation('account.tickets', async (req: NextRequest, ctx) => {
  try {
    const { auth } = await getAccounts()
    const session = await auth.getSession(req.cookies.get(SESSION_COOKIE)?.value)
    if (!session)
      return apiError(401, 'unauthorized', 'Войдите в личный кабинет.', ctx.correlationId)
    const data = await (await getTickets()).accountTickets(session.customer.id, new Date())
    return Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    ctx.log.error('account.tickets_unavailable', { error })
    return apiError(503, 'unavailable', 'Билеты временно недоступны.', ctx.correlationId)
  }
})
