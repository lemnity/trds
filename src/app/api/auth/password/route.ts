import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createRateLimiter } from '@/lib/rate-limit'
import { getAccounts } from '@/modules/accounts'

import { clientIp, json, sameOrigin, sessionCookie } from '../http'

export const dynamic = 'force-dynamic'

// Подбор пароля: лимит и по адресу, и по почте (перебор с разных IP тоже упрётся).
const byIp = createRateLimiter({ limit: 20, windowMs: 10 * 60_000 })
const byEmail = createRateLimiter({ limit: 5, windowMs: 15 * 60_000 })

const body = z.object({ email: z.email(), password: z.string().min(1).max(128) })

/** POST /api/auth/password — вход по паролю (T-055). Ответ одинаков, если почты нет. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403)
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json({ error: 'invalid' }, 400)
  if (!byIp.hit(clientIp(req)) || !byEmail.hit(parsed.data.email.trim().toLowerCase()))
    return json({ error: 'too_many' }, 429)
  const { auth } = await getAccounts()
  const result = await auth.passwordLogin(parsed.data)
  if (!result.ok) return json({ error: 'invalid' }, 400)
  return json({ customer: { name: result.customer.name, email: result.customer.email } }, 200, {
    'Set-Cookie': sessionCookie(result.session.token, result.session.expiresAt),
  })
}
