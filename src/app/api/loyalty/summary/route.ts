import type { NextRequest } from 'next/server'

import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'
import { getWallet } from '@/modules/wallet'

import { fail, guarded, json } from '../../auth/http'

export const dynamic = 'force-dynamic'

/** Публичный адрес для реферальной ссылки: из настроек сайта, иначе — адрес запроса. */
const siteOrigin = (req: NextRequest) =>
  (process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin).replace(/\/$/, '')

/**
 * GET /api/loyalty/summary — баланс, сгорание, история, приглашения и сертификаты зрителя.
 * Ошибки — `{ code, message, correlationId }`: 401 unauthorized; 503 unavailable.
 */
export const GET = guarded('loyalty.summary', async (req: NextRequest, ctx) => {
  const { auth } = await getAccounts()
  const session = await auth.getSession(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session) return fail.unauthorized(ctx)
  const wallet = await getWallet()
  // Только данные покупателя из серверной сессии — никакого customerId из запроса.
  const s = await wallet.summary(session.customer.id, new Date())
  return json({
    balanceKopecks: s.balanceKopecks,
    expiring: s.expiring
      ? { amountKopecks: s.expiring.amountKopecks, earliest: s.expiring.earliest.toISOString() }
      : null,
    history: s.history.map((h) => ({
      id: h.id,
      kind: h.kind,
      amountKopecks: h.amountKopecks,
      at: h.at.toISOString(),
      expiresAt: h.expiresAt?.toISOString() ?? null,
    })),
    referral: {
      code: s.referral.code,
      link: `${siteOrigin(req)}/register?ref=${encodeURIComponent(s.referral.code)}`,
      qualified: s.referral.qualified,
      progress: s.referral.progress,
    },
    certificates: s.certificates.map((c) => ({
      serial: c.serial,
      last4: c.last4,
      amountKopecks: c.amountKopecks,
      activatedAt: c.activatedAt.toISOString(),
      expiresAt: c.expiresAt.toISOString(),
    })),
  })
})
