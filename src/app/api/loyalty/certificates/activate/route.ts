import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createRateLimiter } from '@/lib/rate-limit'
import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'
import { getWallet } from '@/modules/wallet'

import { clientIp, guarded, json, sameOrigin } from '../../../auth/http'

export const dynamic = 'force-dynamic'

// Перебор номеров: не больше 5 неудачных попыток за 15 минут — на покупателя и на IP.
// Удачные активации лимит не расходуют. Плюс общий потолок запросов с одного IP.
const FAILURES = { limit: 5, windowMs: 15 * 60_000 }
const failuresByCustomer = createRateLimiter(FAILURES)
const failuresByIp = createRateLimiter(FAILURES)
const byIp = createRateLimiter({ limit: 30, windowMs: 15 * 60_000 })

const body = z.object({ code: z.string().max(64) })

const ERRORS = {
  FORMAT: [{ error: 'invalid_format' }, 400],
  CHECKSUM: [{ error: 'checksum' }, 400],
  NOT_AVAILABLE: [{ error: 'not_available' }, 422],
} as const

/** POST /api/loyalty/certificates/activate — зачислить номинал сертификата на бонусный баланс. */
export const POST = guarded(async (req: NextRequest) => {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403)
  const ip = clientIp(req)
  if (!byIp.hit(ip)) return json({ error: 'rate_limited' }, 429)
  const { auth } = await getAccounts()
  const session = await auth.getSession(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session) return json({ error: 'unauthorized' }, 401)
  const customerId = session.customer.id
  if (!failuresByCustomer.allowed(customerId) || !failuresByIp.allowed(ip))
    return json({ error: 'rate_limited' }, 429)

  const parsed = body.safeParse(await req.json().catch(() => null))
  const wallet = await getWallet()
  const result = parsed.success
    ? await wallet.activateCertificate(customerId, parsed.data.code, new Date())
    : ({ ok: false, error: 'FORMAT' } as const)
  if (!result.ok) {
    failuresByCustomer.hit(customerId)
    failuresByIp.hit(ip)
    const [payload, status] = ERRORS[result.error]
    return json(payload, status)
  }
  return json({
    ok: true,
    amountKopecks: result.amountKopecks,
    expiresAt: result.expiresAt.toISOString(),
    balanceKopecks: result.balanceKopecks,
  })
})
