import type { NextRequest } from 'next/server'

import { createRateLimiter } from '@/lib/rate-limit'
import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'

import { clientIp, guarded, json, sameOrigin } from '../../../auth/http'

export const dynamic = 'force-dynamic'

const byIp = createRateLimiter({ limit: 10, windowMs: 10 * 60_000 })

/**
 * POST /api/account/password/code — код на почту вошедшего покупателя для смены пароля
 * без старого (T-055). Почта берётся из сессии, не из запроса. Повтор — не чаще раза в минуту
 * и не больше 5 в час (OTP_RULES). Ответы: 200 `{ ok }`; 429 `{ error, retryAfter }`; 401; 403; 503.
 */
export const POST = guarded(async (req: NextRequest) => {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403)
  if (!byIp.hit(clientIp(req))) return json({ error: 'too_many', retryAfter: 600 }, 429)
  const { auth } = await getAccounts()
  const session = await auth.getSession(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session) return json({ error: 'unauthorized' }, 401)
  const result = await auth.requestPasswordCode(session.customer.id)
  if (!result) return json({ error: 'unauthorized' }, 401)
  if (!result.ok) return json(result, 429, { 'Retry-After': String(result.retryAfter) })
  return json({ ok: true })
})
