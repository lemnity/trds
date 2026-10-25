import type { NextRequest } from 'next/server'

import { apiError } from '@/lib/correlation'
import { sharedRateLimiter } from '@/lib/rate-limit'
import { getLeadRequests } from '@/modules/lead-requests'

import { clientIp, fail, guarded, json, sameOrigin } from '../auth/http'

export const dynamic = 'force-dynamic'

// Форма заполняется руками: 5 заявок за 10 минут с адреса хватает с запасом, спам упрётся.
const byIp = sharedRateLimiter({ name: 'leads.ip', limit: 5, windowMs: 10 * 60_000 })

/** Комментарий до 2000 символов + остальные поля — с большим запасом. */
const MAX_BODY_BYTES = 16 * 1024

const parseJson = (text: string): { idempotencyKey?: unknown; lead?: unknown } | null => {
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/**
 * POST /api/leads — заявка на корпоратив (T-034, PRD §5.7).
 * Тело: `{ idempotencyKey, lead: { name, email, phone, date, guests, format, budget, comment, consent } }`.
 * Ответы: 201 `{ ok, status }` — создана; 200 `{ ok, status, replay: true }` — эта отправка уже
 * принята; ошибки `{ code, message, correlationId }`: 400 `invalid` (+ `fields`); 409 `conflict`;
 * 403; 413; 429; 503.
 */
export const POST = guarded('leads.create', async (req: NextRequest, ctx) => {
  if (!sameOrigin(req)) return fail.forbidden(ctx)
  const tooLarge = () => apiError(413, 'too_large', 'Слишком большой запрос.', ctx.correlationId)
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return tooLarge()
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) return tooLarge()
  const body = parseJson(text)
  if (!body) return fail.invalid(ctx)
  if (!(await byIp.hit(clientIp(req)))) return fail.tooMany(ctx, 600)

  const leads = await getLeadRequests()
  const result = await leads.submit({
    form: body.lead,
    idempotencyKey: body.idempotencyKey,
    source: 'corporate',
  })
  if (result.ok)
    return json(
      { ok: true, status: result.status, ...(result.replay && { replay: true }) },
      result.replay ? 200 : 201,
    )
  if (result.error === 'invalid') return fail.invalid(ctx, { fields: result.fields })
  if (result.error === 'invalid_key') return fail.invalid(ctx)
  return apiError(
    409,
    'conflict',
    'Заявка изменилась во время отправки — отправьте ещё раз.',
    ctx.correlationId,
  )
})
