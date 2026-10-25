import type { NextRequest } from 'next/server'

import { createRateLimiter } from '@/lib/rate-limit'
import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'

import { clearedSessionCookie, clientIp, guarded, json, sameOrigin } from '../../auth/http'

export const dynamic = 'force-dynamic'

const byIp = createRateLimiter({ limit: 10, windowMs: 10 * 60_000 })

/**
 * DELETE /api/account/sessions — «Выйти на всех устройствах» (T-055): отозвать все сессии
 * покупателя, включая текущую, и стереть cookie. Ответы: 200 `{ ok }`; 401; 403; 429; 503.
 */
export const DELETE = guarded(async (req: NextRequest) => {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403)
  if (!byIp.hit(clientIp(req))) return json({ error: 'too_many' }, 429)
  const { auth } = await getAccounts()
  const session = await auth.getSession(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session)
    return json({ error: 'unauthorized' }, 401, { 'Set-Cookie': clearedSessionCookie() })
  await auth.logoutEverywhere(session.customer.id)
  return json({ ok: true }, 200, { 'Set-Cookie': clearedSessionCookie() })
})
