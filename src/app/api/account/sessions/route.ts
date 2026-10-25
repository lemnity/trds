import type { NextRequest } from 'next/server'

import { sharedRateLimiter } from '@/lib/rate-limit'
import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'

import { clearedSessionCookie, clientIp, fail, guarded, json, sameOrigin } from '../../auth/http'

export const dynamic = 'force-dynamic'

const byIp = sharedRateLimiter({ name: 'account.sessions.ip', limit: 10, windowMs: 10 * 60_000 })

/**
 * DELETE /api/account/sessions — «Выйти на всех устройствах» (T-055): отозвать все сессии
 * покупателя, включая текущую, и стереть cookie. Ответы: 200 `{ ok }`; 401; 403; 429; 503 —
 * ошибки `{ code, message, correlationId }`.
 */
export const DELETE = guarded('account.sessions', async (req: NextRequest, ctx) => {
  if (!sameOrigin(req)) return fail.forbidden(ctx)
  if (!(await byIp.hit(clientIp(req)))) return fail.tooMany(ctx)
  const { auth } = await getAccounts()
  const session = await auth.getSession(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session) return fail.unauthorized(ctx, { 'Set-Cookie': clearedSessionCookie() })
  await auth.logoutEverywhere(session.customer.id)
  return json({ ok: true }, 200, { 'Set-Cookie': clearedSessionCookie() })
})
