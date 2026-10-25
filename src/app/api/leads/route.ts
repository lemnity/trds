import type { NextRequest } from 'next/server'

import { createRateLimiter } from '@/lib/rate-limit'
import { getLeadRequests } from '@/modules/lead-requests'

import { clientIp, guarded, json, sameOrigin } from '../auth/http'

export const dynamic = 'force-dynamic'

// Форма заполняется руками: 5 заявок за 10 минут с адреса хватает с запасом, спам упрётся.
const byIp = createRateLimiter({ limit: 5, windowMs: 10 * 60_000 })

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
 * принята; 400 `{ error: 'invalid', fields }`; 409 `{ error: 'conflict' }`; 403; 413; 429; 503.
 */
export const POST = guarded(async (req: NextRequest) => {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403)
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES)
    return json({ error: 'too_large' }, 413)
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413)
  const body = parseJson(text)
  if (!body) return json({ error: 'invalid' }, 400)
  if (!byIp.hit(clientIp(req))) return json({ error: 'too_many' }, 429, { 'Retry-After': '600' })

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
  if (result.error === 'invalid') return json({ error: 'invalid', fields: result.fields }, 400)
  if (result.error === 'invalid_key') return json({ error: 'invalid' }, 400)
  return json({ error: 'conflict' }, 409)
})
