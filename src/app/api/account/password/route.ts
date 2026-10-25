import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createRateLimiter } from '@/lib/rate-limit'
import { getAccounts, PASSWORD_MAX, SESSION_COOKIE } from '@/modules/accounts'
import { PASSWORD_MIN } from '@/modules/auth'

import { clientIp, guarded, json, sameOrigin } from '../../auth/http'

export const dynamic = 'force-dynamic'

// Подбор текущего пароля из чужой сессии: лимит и по адресу, и по покупателю.
const byIp = createRateLimiter({ limit: 20, windowMs: 10 * 60_000 })
const byCustomer = createRateLimiter({ limit: 5, windowMs: 15 * 60_000 })

const body = z.object({
  next: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
  current: z.string().min(1).max(PASSWORD_MAX).optional(),
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
})

/**
 * POST /api/account/password — задать или сменить пароль (T-055).
 * Тело: `{ next, current? , code? }` — для смены нужен текущий пароль или код из письма
 * (`POST /api/account/password/code`). Ответы: 200 `{ ok }` (остальные устройства вышли);
 * 400 `{ error: 'invalid' | 'weak' | 'proof_required' | 'invalid_current' | 'invalid_code' }`;
 * 401; 403; 429; 503.
 */
export const POST = guarded(async (req: NextRequest) => {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403)
  if (!byIp.hit(clientIp(req))) return json({ error: 'too_many' }, 429)
  const { auth } = await getAccounts()
  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = await auth.getSession(token)
  if (!session) return json({ error: 'unauthorized' }, 401)
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const weak = parsed.error.issues.some((i) => i.path[0] === 'next')
    return json({ error: weak ? 'weak' : 'invalid' }, 400)
  }
  if (!byCustomer.hit(session.customer.id))
    return json({ error: 'too_many', retryAfter: 15 * 60 }, 429)
  const result = await auth.changePassword({
    customerId: session.customer.id,
    next: parsed.data.next,
    current: parsed.data.current,
    code: parsed.data.code,
    keepToken: token,
  })
  if (result.ok) return json({ ok: true })
  if (result.error === 'unknown') return json({ error: 'unauthorized' }, 401)
  return json({ error: result.error }, 400)
})
