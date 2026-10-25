import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { apiError } from '@/lib/correlation'
import { sharedRateLimiter } from '@/lib/rate-limit'
import {
  getAccounts,
  SIGNUP_COOKIE,
  unseal,
  yandexConfig,
  type PendingSignup,
} from '@/modules/accounts'
import { attachReferralOnSignup, getWallet } from '@/modules/wallet'

import { clientIp, fail, guarded, json, sameOrigin, sessionCookie } from '../../http'
import { clearedSignupCookie, withCookies } from '../http'

export const dynamic = 'force-dynamic'

const byIp = sharedRateLimiter({
  name: 'auth.yandex_complete.ip',
  limit: 10,
  windowMs: 10 * 60_000,
})

const body = z.object({ consent: z.literal(true) })

/**
 * POST /api/auth/yandex/complete — регистрация через Яндекс ID после согласия на обработку ПД
 * (T-056). Тело `{ consent: true }`; данные профиля — только из зашифрованной cookie, которую
 * поставил callback (15 минут), не из запроса. Согласие пишется в журнал до создания аккаунта;
 * `ref` из начала входа привязывает приглашение только к созданному сейчас покупателю.
 * 200 `{ customer, next }` + cookie сессии; ошибки `{ code, message, correlationId }`:
 * 400 invalid (нет согласия) | expired (cookie нет/истекла); 403; 429; 503 yandex_unavailable.
 */
export const POST = guarded('auth.yandex_complete', async (req: NextRequest, ctx) => {
  if (!sameOrigin(req)) return fail.forbidden(ctx)
  const config = yandexConfig()
  if (!config)
    return apiError(
      503,
      'yandex_unavailable',
      'Вход через Яндекс ID не подключён.',
      ctx.correlationId,
    )
  if (!(await byIp.hit(clientIp(req)))) return fail.tooMany(ctx)
  if (!body.safeParse(await req.json().catch(() => null)).success) return fail.invalid(ctx)
  const pending = unseal<PendingSignup>(config.cookieKey, req.cookies.get(SIGNUP_COOKIE)?.value)
  if (!pending)
    return apiError(400, 'expired', 'Начните вход через Яндекс ID заново.', ctx.correlationId)

  const { auth, consent } = await getAccounts()
  await consent(pending.profile.email, 'register:yandex')
  const result = await auth.externalSignUp(pending.profile)
  if (!result.ok)
    return apiError(400, 'expired', 'Начните вход через Яндекс ID заново.', ctx.correlationId)
  if (pending.ref) {
    const outcome = await attachReferralOnSignup(
      async (...args) => (await getWallet()).attachReferral(...args),
      {
        created: result.created,
        customerId: result.customer.id,
        ref: pending.ref,
        now: new Date(),
      },
    )
    if (outcome === 'failed') ctx.log.error('auth.referral_attach_failed')
  }
  ctx.log.info('auth.yandex_signed_up', { created: result.created })
  return withCookies(
    json({
      customer: { name: result.customer.name, email: result.customer.email },
      next: pending.next,
    }),
    [sessionCookie(result.session.token, result.session.expiresAt), clearedSignupCookie()],
  )
})
