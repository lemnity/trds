import type { NextRequest } from 'next/server'

import { sharedRateLimiter } from '@/lib/rate-limit'
import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'

import { clientIp, fail, guarded, json, sameOrigin } from '../../http'

export const dynamic = 'force-dynamic'

const byIp = sharedRateLimiter({ name: 'auth.yandex_unlink.ip', limit: 10, windowMs: 10 * 60_000 })

/**
 * DELETE /api/auth/yandex/link — отвязать Яндекс ID в профиле (T-056). Разрешено и без пароля:
 * вход кодом на почту кабинета остаётся всегда. Привязка — `POST /api/auth/yandex/start`
 * с `mode=link`. 200 `{ ok }`; ошибки `{ code, message, correlationId }`: 401; 403; 429; 503.
 */
export const DELETE = guarded('auth.yandex_unlink', async (req: NextRequest, ctx) => {
  if (!sameOrigin(req)) return fail.forbidden(ctx)
  if (!(await byIp.hit(clientIp(req)))) return fail.tooMany(ctx)
  const { auth } = await getAccounts()
  const session = await auth.getSession(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session) return fail.unauthorized(ctx)
  await auth.unlinkIdentity(session.customer.id, 'yandex')
  ctx.log.info('auth.yandex_unlinked')
  return json({ ok: true })
})
