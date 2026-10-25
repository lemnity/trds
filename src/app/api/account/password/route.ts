import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { apiError } from '@/lib/correlation'
import { sharedRateLimiter } from '@/lib/rate-limit'
import { getAccounts, PASSWORD_MAX, SESSION_COOKIE } from '@/modules/accounts'
import { PASSWORD_MIN } from '@/modules/auth'

import { clientIp, fail, guarded, json, sameOrigin } from '../../auth/http'

export const dynamic = 'force-dynamic'

// Подбор текущего пароля из чужой сессии: лимит и по адресу, и по покупателю.
const byIp = sharedRateLimiter({ name: 'account.password.ip', limit: 20, windowMs: 10 * 60_000 })
const byCustomer = sharedRateLimiter({
  name: 'account.password.customer',
  limit: 5,
  windowMs: 15 * 60_000,
})

const body = z.object({
  next: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
  current: z.string().min(1).max(PASSWORD_MAX).optional(),
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
})

const MESSAGES = {
  weak: 'Пароль слишком короткий или длинный.',
  proof_required: 'Нужен текущий пароль или код из письма.',
  invalid_current: 'Неверный текущий пароль.',
  invalid_code: 'Неверный или устаревший код.',
} as const

/**
 * POST /api/account/password — задать или сменить пароль (T-055).
 * Тело: `{ next, current? , code? }` — для смены нужен текущий пароль или код из письма
 * (`POST /api/account/password/code`). Ответы: 200 `{ ok }` (остальные устройства вышли);
 * ошибки `{ code, message, correlationId }`: 400 `invalid | weak | proof_required |
 * invalid_current | invalid_code`; 401; 403; 429; 503.
 */
export const POST = guarded('account.password', async (req: NextRequest, ctx) => {
  if (!sameOrigin(req)) return fail.forbidden(ctx)
  if (!(await byIp.hit(clientIp(req)))) return fail.tooMany(ctx)
  const { auth } = await getAccounts()
  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = await auth.getSession(token)
  if (!session) return fail.unauthorized(ctx)
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const weak = parsed.error.issues.some((i) => i.path[0] === 'next')
    return weak ? apiError(400, 'weak', MESSAGES.weak, ctx.correlationId) : fail.invalid(ctx)
  }
  if (!(await byCustomer.hit(session.customer.id))) return fail.tooMany(ctx, 15 * 60)
  const result = await auth.changePassword({
    customerId: session.customer.id,
    next: parsed.data.next,
    current: parsed.data.current,
    code: parsed.data.code,
    keepToken: token,
  })
  if (result.ok) return json({ ok: true })
  if (result.error === 'unknown') return fail.unauthorized(ctx)
  return apiError(400, result.error, MESSAGES[result.error], ctx.correlationId)
})
