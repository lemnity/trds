import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createRateLimiter } from '@/lib/rate-limit'
import { getAccounts } from '@/modules/accounts'
import { attachReferralOnSignup, getWallet } from '@/modules/wallet'

import { clientIp, json, sameOrigin, sessionCookie, guarded } from '../../http'

export const dynamic = 'force-dynamic'

const byIp = createRateLimiter({ limit: 30, windowMs: 10 * 60_000 })

const body = z.object({
  email: z.email(),
  code: z.string().regex(/^\d{6}$/),
  // Код приглашения друга (T-062); кривой код не мешает входу — просто не учитывается.
  ref: z.string().max(32).optional().catch(undefined),
})

/**
 * POST /api/auth/email-code/verify — проверить код, открыть сессию (HttpOnly cookie).
 * `ref` из `/register?ref=` привязывает приглашение только к только что созданному покупателю.
 */
export const POST = guarded(async (req: NextRequest) => {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403)
  if (!byIp.hit(clientIp(req))) return json({ error: 'too_many' }, 429)
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json({ error: 'invalid' }, 400)
  const { auth } = await getAccounts()
  const result = await auth.verifyCode(parsed.data)
  if (!result.ok) return json({ error: 'invalid' }, 400)
  const { customer, session } = result
  if (parsed.data.ref) {
    const outcome = await attachReferralOnSignup(
      async (...args) => (await getWallet()).attachReferral(...args),
      { created: result.created, customerId: customer.id, ref: parsed.data.ref, now: new Date() },
    )
    // В лог — только исход, без почты и кода.
    if (outcome === 'failed') console.error('[auth] referral attach failed')
  }
  return json({ customer: { name: customer.name, email: customer.email } }, 200, {
    'Set-Cookie': sessionCookie(session.token, session.expiresAt),
  })
})
