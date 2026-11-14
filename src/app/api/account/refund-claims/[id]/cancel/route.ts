import type { NextRequest } from 'next/server'

import { getRefundClaims } from '@/modules/refund-claims'

import { fail, guarded, json, sameOrigin } from '../../../../auth/http'
import { claimError, claimJson, session } from '../../shared'

export const dynamic = 'force-dynamic'

/** POST /api/account/refund-claims/:id/cancel — зритель отзывает свою заявку. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return guarded('account.refund_claims.cancel', async (req: NextRequest, ctx) => {
    if (!sameOrigin(req)) return fail.forbidden(ctx)
    const s = await session(req)
    if (!s) return fail.unauthorized(ctx)
    if (!/^[0-9a-f-]{36}$/.test(id)) return fail.invalid(ctx)
    const result = await (await getRefundClaims()).cancel(s.customer.id, id)
    if (!result.ok) return claimError(result.error, ctx.correlationId)
    return json({ claim: claimJson(result.value) })
  })(req)
}
