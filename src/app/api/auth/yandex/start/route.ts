import type { NextRequest } from 'next/server'

import { sharedRateLimiter } from '@/lib/rate-limit'
import {
  getAccounts,
  seal,
  SESSION_COOKIE,
  OAUTH_TTL_SEC,
  startOAuth,
  yandexConfig,
  type OAuthMode,
} from '@/modules/accounts'
import { normalizeReferralCode } from '@/modules/loyalty'

import { clientIp, fail, guarded, sameOrigin } from '../../http'
import { backPath, oauthCookie, redirectTo } from '../http'

export const dynamic = 'force-dynamic'

const byIp = sharedRateLimiter({ name: 'auth.yandex_start.ip', limit: 30, windowMs: 10 * 60_000 })

const MODES: OAuthMode[] = ['login', 'register', 'link']

/**
 * POST /api/auth/yandex/start — начать вход/регистрацию/привязку через Яндекс ID (T-056).
 * Форма (`application/x-www-form-urlencoded`): `mode` = login | register | link, `next` (путь
 * своего сайта), `ref` (код друга). POST с проверкой Origin: чужой сайт не запустит привязку
 * от имени зрителя. Ответ — 303 на oauth.yandex.ru с `state` и PKCE `code_challenge`; state и
 * verifier — в зашифрованной HttpOnly cookie на 10 минут. Выключено (нет настроек) — 303 назад
 * с `?yandex=unavailable`. Привязка без входа — на /login.
 */
export const POST = guarded('auth.yandex_start', async (req: NextRequest, ctx) => {
  if (!sameOrigin(req)) return fail.forbidden(ctx)
  const form = await req.formData().catch(() => null)
  const rawMode = String(form?.get('mode') ?? 'login') as OAuthMode
  const mode = MODES.includes(rawMode) ? rawMode : 'login'
  const back = backPath(mode)
  const config = yandexConfig()
  if (!config) return redirectTo(`${back}?yandex=unavailable`)
  if (!(await byIp.hit(clientIp(req)))) return redirectTo(`${back}?yandex=too_many`)

  let customerId: string | null = null
  if (mode === 'link') {
    const { auth } = await getAccounts()
    const session = await auth.getSession(req.cookies.get(SESSION_COOKIE)?.value)
    if (!session) return redirectTo('/login?next=/account')
    customerId = session.customer.id
  }
  const next = form?.get('next')
  const ref = form?.get('ref')
  const { url, state } = startOAuth(config, {
    mode,
    next: typeof next === 'string' ? next : null,
    // Приглашение — только для новых (как в регистрации по коду); при привязке не нужно.
    ref: mode === 'link' ? null : normalizeReferralCode(typeof ref === 'string' ? ref : null),
    customerId,
  })
  ctx.log.info('auth.yandex_started', { mode })
  return redirectTo(url, [oauthCookie(seal(config.cookieKey, state, OAUTH_TTL_SEC))])
})
