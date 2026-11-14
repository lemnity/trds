import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { sharedRateLimiter } from '@/lib/rate-limit'
import { getRefundClaims } from '@/modules/refund-claims'
import { CLAIM_REASONS } from '@/modules/refunds'

import { clientIp, fail, guarded, json, sameOrigin } from '../../auth/http'
import { claimError, claimJson, session, TICKET } from './shared'

export const dynamic = 'force-dynamic'

const byCustomer = sharedRateLimiter({
  name: 'account.refund_claims.customer',
  limit: 10,
  windowMs: 15 * 60_000,
})
const byIp = sharedRateLimiter({
  name: 'account.refund_claims.ip',
  limit: 30,
  windowMs: 15 * 60_000,
})

const body = z.object({
  tickets: z.array(z.string().regex(TICKET)).min(1).max(20),
  reason: z.enum(CLAIM_REASONS),
  comment: z.string().max(1000).optional().nullable(),
})

/** GET /api/account/refund-claims — заявки покупателя на возврат (новые сверху). */
export const GET = guarded('account.refund_claims.list', async (req: NextRequest, ctx) => {
  const s = await session(req)
  if (!s) return fail.unauthorized(ctx)
  const claims = await (await getRefundClaims()).listForCustomer(s.customer.id)
  return json({ claims: claims.map(claimJson) })
})

/**
 * POST /api/account/refund-claims — подать заявку `{ tickets, reason, comment }`. Деньги не
 * возвращаются сразу: заявку рассматривает сотрудник театра (ст. 52.1 Закона о культуре).
 */
export const POST = guarded('account.refund_claims.submit', async (req: NextRequest, ctx) => {
  if (!sameOrigin(req)) return fail.forbidden(ctx)
  if (!(await byIp.hit(clientIp(req)))) return fail.tooMany(ctx, 15 * 60)
  const s = await session(req)
  if (!s) return fail.unauthorized(ctx)
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail.invalid(ctx)
  if (!(await byCustomer.hit(s.customer.id))) return fail.tooMany(ctx, 15 * 60)
  const result = await (
    await getRefundClaims()
  ).submit({
    customerId: s.customer.id,
    ticketNumbers: parsed.data.tickets,
    reason: parsed.data.reason,
    comment: parsed.data.comment,
  })
  if (!result.ok) return claimError(result.error, ctx.correlationId)
  ctx.log.info('refund_claim.submitted', { claim: result.value.number })
  return json({ claim: claimJson(result.value) })
})
