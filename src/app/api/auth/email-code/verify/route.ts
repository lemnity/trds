import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { apiError } from '@/lib/correlation'
import { sharedRateLimiter } from '@/lib/rate-limit'
import { getAccounts } from '@/modules/accounts'
import { attachReferralOnSignup, getWallet } from '@/modules/wallet'

import { clientIp, fail, guarded, json, sameOrigin, sessionCookie } from '../../http'

export const dynamic = 'force-dynamic'

const byIp = sharedRateLimiter({ name: 'auth.code_verify.ip', limit: 30, windowMs: 10 * 60_000 })

const body = z.object({
  email: z.email(),
  code: z.string().regex(/^\d{6}$/),
  // Код приглашения друга (T-062); кривой код не мешает входу — просто не учитывается.
  ref: z.string().max(32).optional().catch(undefined),
})

/**
 * POST /api/auth/email-code/verify — проверить код, открыть сессию (HttpOnly cookie).
 * `ref` из `/register?ref=` привязывает приглашение только к только что созданному покупателю.
 * 200 `{ customer }`; ошибки `{ code, message, correlationId }`: 400 invalid; 403; 429; 503.
 */
export const POST = guarded('auth.code_verify', async (req: NextRequest, ctx) => {
  if (!sameOrigin(req)) return fail.forbidden(ctx)
  if (!(await byIp.hit(clientIp(req)))) return fail.tooMany(ctx)
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail.invalid(ctx)
  const { auth } = await getAccounts()
  const result = await auth.verifyCode(parsed.data)
  if (!result.ok) return apiError(400, 'invalid', 'Неверный или устаревший код.', ctx.correlationId)
  const { customer, session } = result
  if (parsed.data.ref) {
    const outcome = await attachReferralOnSignup(
      async (...args) => (await getWallet()).attachReferral(...args),
      { created: result.created, customerId: customer.id, ref: parsed.data.ref, now: new Date() },
    )
    // В лог — только исход, без почты и кода.
    if (outcome === 'failed') ctx.log.error('auth.referral_attach_failed')
  }
  return json({ customer: { name: customer.name, email: customer.email } }, 200, {
    'Set-Cookie': sessionCookie(session.token, session.expiresAt),
  })
})
