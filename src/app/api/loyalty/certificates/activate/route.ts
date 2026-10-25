import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { apiError } from '@/lib/correlation'
import { sharedRateLimiter } from '@/lib/rate-limit'
import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'
import { getWallet } from '@/modules/wallet'

import { clientIp, fail, guarded, json, sameOrigin } from '../../../auth/http'

export const dynamic = 'force-dynamic'

// Перебор номеров: не больше 5 неудачных попыток за 15 минут — на покупателя и на IP.
// Удачные активации лимит не расходуют. Плюс общий потолок запросов с одного IP.
const FAILURES = { limit: 5, windowMs: 15 * 60_000 }
const failuresByCustomer = sharedRateLimiter({ name: 'certificate.failures.customer', ...FAILURES })
const failuresByIp = sharedRateLimiter({ name: 'certificate.failures.ip', ...FAILURES })
const byIp = sharedRateLimiter({ name: 'certificate.ip', limit: 30, windowMs: 15 * 60_000 })

const body = z.object({ code: z.string().max(64) })

const ERRORS = {
  FORMAT: [400, 'invalid_format', 'Проверьте номер сертификата.'],
  CHECKSUM: [400, 'checksum', 'В номере сертификата опечатка.'],
  NOT_AVAILABLE: [422, 'not_available', 'Сертификат не найден или уже активирован.'],
} as const

/**
 * POST /api/loyalty/certificates/activate — зачислить номинал сертификата на бонусный баланс.
 * 200 `{ ok, amountKopecks, expiresAt, balanceKopecks }`; ошибки `{ code, message, correlationId }`:
 * 400 `invalid_format | checksum`; 422 `not_available`; 401; 403; 429 `rate_limited`; 503.
 */
export const POST = guarded('loyalty.certificate_activate', async (req: NextRequest, ctx) => {
  const rateLimited = () =>
    apiError(429, 'rate_limited', 'Слишком много попыток. Подождите 15 минут.', ctx.correlationId)
  if (!sameOrigin(req)) return fail.forbidden(ctx)
  const ip = clientIp(req)
  if (!(await byIp.hit(ip))) return rateLimited()
  const { auth } = await getAccounts()
  const session = await auth.getSession(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session) return fail.unauthorized(ctx)
  const customerId = session.customer.id
  if (!(await failuresByCustomer.allowed(customerId)) || !(await failuresByIp.allowed(ip)))
    return rateLimited()

  const parsed = body.safeParse(await req.json().catch(() => null))
  const wallet = await getWallet()
  const result = parsed.success
    ? await wallet.activateCertificate(customerId, parsed.data.code, new Date())
    : ({ ok: false, error: 'FORMAT' } as const)
  if (!result.ok) {
    await failuresByCustomer.hit(customerId)
    await failuresByIp.hit(ip)
    const [status, code, message] = ERRORS[result.error]
    return apiError(status, code, message, ctx.correlationId)
  }
  return json({
    ok: true,
    amountKopecks: result.amountKopecks,
    expiresAt: result.expiresAt.toISOString(),
    balanceKopecks: result.balanceKopecks,
  })
})
