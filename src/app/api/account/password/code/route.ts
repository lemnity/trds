import type { NextRequest } from 'next/server'

import { apiError } from '@/lib/correlation'
import { sharedRateLimiter } from '@/lib/rate-limit'
import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'

import { clientIp, fail, guarded, json, sameOrigin } from '../../../auth/http'

export const dynamic = 'force-dynamic'

const byIp = sharedRateLimiter({
  name: 'account.password_code.ip',
  limit: 10,
  windowMs: 10 * 60_000,
})

/**
 * POST /api/account/password/code — код на почту вошедшего покупателя для смены пароля
 * без старого (T-055). Почта берётся из сессии, не из запроса. Повтор — не чаще раза в минуту
 * и не больше 5 в час (OTP_RULES). Ответы: 200 `{ ok }`; ошибки `{ code, message, correlationId }`:
 * 429 `cooldown | too_many` (+ `retryAfter`); 401; 403; 503.
 */
export const POST = guarded('account.password_code', async (req: NextRequest, ctx) => {
  if (!sameOrigin(req)) return fail.forbidden(ctx)
  if (!(await byIp.hit(clientIp(req)))) return fail.tooMany(ctx, 600)
  const { auth } = await getAccounts()
  const session = await auth.getSession(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session) return fail.unauthorized(ctx)
  const result = await auth.requestPasswordCode(session.customer.id)
  if (!result) return fail.unauthorized(ctx)
  if (!result.ok)
    return apiError(
      429,
      result.error,
      result.error === 'cooldown' ? 'Код уже отправлен.' : 'Слишком много писем.',
      ctx.correlationId,
      { 'Retry-After': String(result.retryAfter) },
      { retryAfter: result.retryAfter },
    )
  return json({ ok: true })
})
