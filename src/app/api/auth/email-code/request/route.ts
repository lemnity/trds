import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createRateLimiter } from '@/lib/rate-limit'
import { EmailNotConfiguredError, getAccounts } from '@/modules/accounts'
import { PASSWORD_MIN } from '@/modules/auth'

import { clientIp, json, sameOrigin } from '../../http'

export const dynamic = 'force-dynamic'

const byIp = createRateLimiter({ limit: 20, windowMs: 10 * 60_000 })

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

/** POST /api/auth/email-code/request — выслать код. Ответ одинаков для любой почты. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403)
  if (!byIp.hit(clientIp(req))) return json({ error: 'too_many' }, 429)
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json({ error: 'invalid' }, 400)
  const input = parsed.data
  try {
    const { auth, consent } = await getAccounts()
    const result = await auth.requestCode({
      email: input.email,
      purpose: input.purpose,
      ...(input.purpose === 'register' && { name: input.name, password: input.password }),
    })
    if (!result.ok) return json(result, 429, { 'Retry-After': String(result.retryAfter) })
    if (input.purpose === 'register') await consent(input.email, 'register')
    return json({ ok: true })
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) return json({ error: 'email_unavailable' }, 503)
    throw error
  }
}
