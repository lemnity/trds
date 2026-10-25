import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { apiError } from '@/lib/correlation'
import { sharedRateLimiter } from '@/lib/rate-limit'
import { getAccounts } from '@/modules/accounts'

import { clientIp, fail, guarded, json, sameOrigin, sessionCookie } from '../http'

export const dynamic = 'force-dynamic'

// Подбор пароля: лимит и по адресу, и по почте (перебор с разных IP тоже упрётся).
const byIp = sharedRateLimiter({ name: 'auth.password.ip', limit: 20, windowMs: 10 * 60_000 })
const byEmail = sharedRateLimiter({ name: 'auth.password.email', limit: 5, windowMs: 15 * 60_000 })

const body = z.object({ email: z.email(), password: z.string().min(1).max(128) })

/**
 * POST /api/auth/password — вход по паролю (T-055). Ответ одинаков, если почты нет.
 * 200 `{ customer }`; ошибки `{ code, message, correlationId }`: 400 invalid; 403; 429; 503.
 */
export const POST = guarded('auth.password', async (req: NextRequest, ctx) => {
  if (!sameOrigin(req)) return fail.forbidden(ctx)
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail.invalid(ctx)
  if (
    !(await byIp.hit(clientIp(req))) ||
    !(await byEmail.hit(parsed.data.email.trim().toLowerCase()))
  )
    return fail.tooMany(ctx)
  const { auth } = await getAccounts()
  const result = await auth.passwordLogin(parsed.data)
  if (!result.ok) return apiError(400, 'invalid', 'Неверная почта или пароль.', ctx.correlationId)
  return json({ customer: { name: result.customer.name, email: result.customer.email } }, 200, {
    'Set-Cookie': sessionCookie(result.session.token, result.session.expiresAt),
  })
})
