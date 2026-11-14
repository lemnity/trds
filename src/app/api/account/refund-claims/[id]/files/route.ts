import type { NextRequest } from 'next/server'

import { sharedRateLimiter } from '@/lib/rate-limit'
import { getRefundClaims, MAX_FILE_BYTES } from '@/modules/refund-claims'

import { clientIp, fail, guarded, json, sameOrigin } from '../../../../auth/http'
import { claimError, session } from '../../shared'

export const dynamic = 'force-dynamic'

const byIp = sharedRateLimiter({
  name: 'account.refund_claims.files.ip',
  limit: 30,
  windowMs: 15 * 60_000,
})

/**
 * POST /api/account/refund-claims/:id/files — подтверждающий документ (multipart, поле `file`):
 * PDF или фото до 10 МБ, до 5 файлов, пока заявка не решена и не прошло 14 дней после спектакля.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return guarded('account.refund_claims.file', async (req: NextRequest, ctx) => {
    if (!sameOrigin(req)) return fail.forbidden(ctx)
    if (!(await byIp.hit(clientIp(req)))) return fail.tooMany(ctx, 15 * 60)
    const s = await session(req)
    if (!s) return fail.unauthorized(ctx)
    if (!/^[0-9a-f-]{36}$/.test(id)) return fail.invalid(ctx)
    // Заголовок длины проверяем до чтения тела — большой файл не попадает в память целиком.
    const length = Number(req.headers.get('content-length') ?? 0)
    if (length > MAX_FILE_BYTES + 64 * 1024) return claimError('FILE_TOO_LARGE', ctx.correlationId)
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!file || typeof file === 'string') return fail.invalid(ctx)
    if (file.size > MAX_FILE_BYTES) return claimError('FILE_TOO_LARGE', ctx.correlationId)
    const result = await (
      await getRefundClaims()
    ).addFile({
      customerId: s.customer.id,
      claimId: id,
      name: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
    })
    if (!result.ok) return claimError(result.error, ctx.correlationId)
    return json({
      file: {
        id: result.value.id,
        name: result.value.originalName,
        uploadedAt: result.value.uploadedAt.toISOString(),
      },
    })
  })(req)
}
