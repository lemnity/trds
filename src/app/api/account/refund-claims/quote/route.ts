import type { NextRequest } from 'next/server'

import { getRefundClaims } from '@/modules/refund-claims'
import { CLAIM_BASIS_TEXT, CLAIM_REASONS, type ClaimReason } from '@/modules/refunds'

import { fail, guarded, json } from '../../../auth/http'
import { claimError, session, TICKET } from '../shared'

export const dynamic = 'force-dynamic'

/**
 * GET /api/account/refund-claims/quote?tickets=…&reason=… — что положено по закону до подачи
 * заявки: процент, сумма, нужен ли документ, крайние сроки и понятное объяснение.
 */
export const GET = guarded('account.refund_claims.quote', async (req: NextRequest, ctx) => {
  const s = await session(req)
  if (!s) return fail.unauthorized(ctx)
  const numbers = (req.nextUrl.searchParams.get('tickets') ?? '').split(',').filter(Boolean)
  const reason = req.nextUrl.searchParams.get('reason') ?? 'CHANGED_MIND'
  if (!numbers.length || numbers.length > 20 || !numbers.every((n) => TICKET.test(n)))
    return fail.invalid(ctx)
  if (!(CLAIM_REASONS as readonly string[]).includes(reason)) return fail.invalid(ctx)
  const q = await (await getRefundClaims()).quote(s.customer.id, numbers, reason as ClaimReason)
  if (!q.ok) return claimError(q.error, ctx.correlationId)
  const { assessment: a } = q.value
  return json({
    orderNumber: q.value.orderNumber,
    ticketNumbers: q.value.ticketNumbers,
    showTitle: q.value.showTitle,
    startsAt: q.value.startsAt.toISOString(),
    percent: a.percent,
    basis: a.basis,
    basisText: CLAIM_BASIS_TEXT[a.basis],
    canSubmit: a.canSubmit,
    includeFee: a.includeFee,
    documentRequired: a.documentRequired,
    documentDeadline: a.documentDeadline?.toISOString() ?? null,
    submitDeadline: a.submitDeadline.toISOString(),
    amounts: q.value.amounts,
    feeKeptKopecks: q.value.feeKeptKopecks,
  })
})
