import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { apiError } from '@/lib/correlation'
import { sharedRateLimiter } from '@/lib/rate-limit'
import { getAccounts } from '@/modules/accounts'
import { PASSWORD_MIN } from '@/modules/auth'

import { clientIp, fail, guarded, json, sameOrigin } from '../../http'

export const dynamic = 'force-dynamic'

const byIp = sharedRateLimiter({ name: 'auth.code_request.ip', limit: 20, windowMs: 10 * 60_000 })

const body = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('login'), email: z.email() }),
  z.object({
    purpose: z.literal('register'),
    email: z.email(),
    name: z.string().trim().min(1).max(100),
    password: z.string().min(PASSWORD_MIN).max(128),
    consent: z.literal(true),
  }),
])

/**
 * POST /api/auth/email-code/request — выслать код. Ответ одинаков для любой почты.
 * 200 `{ ok }`; ошибки `{ code, message, correlationId }`: 400 invalid; 403; 429 `too_many`
 * или `cooldown` (+ `retryAfter`); 503 `unavailable | email_unavailable`.
 */
export const POST = guarded('auth.code_request', async (req: NextRequest, ctx) => {
  if (!sameOrigin(req)) return fail.forbidden(ctx)
  if (!(await byIp.hit(clientIp(req)))) return fail.tooMany(ctx)
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail.invalid(ctx)
  const input = parsed.data
  const { auth, consent } = await getAccounts()
  const result = await auth.requestCode({
    email: input.email,
    purpose: input.purpose,
    ...(input.purpose === 'register' && { name: input.name, password: input.password }),
  })
  if (!result.ok)
    return apiError(
      429,
      result.error,
      result.error === 'cooldown' ? 'Код уже отправлен.' : 'Слишком много писем.',
      ctx.correlationId,
      { 'Retry-After': String(result.retryAfter) },
      { retryAfter: result.retryAfter },
    )
  if (input.purpose === 'register') await consent(input.email, 'register')
  return json({ ok: true })
})
