import type { NextRequest } from 'next/server'

import { withCorrelation } from '@/lib/correlation'
import { errorInfo } from '@/lib/log'
import { sharedRateLimiter } from '@/lib/rate-limit'
import {
  checkCallback,
  fetchYandexProfile,
  getAccounts,
  OAUTH_COOKIE,
  seal,
  SESSION_COOKIE,
  SIGNUP_TTL_SEC,
  unseal,
  yandexConfig,
  type OAuthState,
  type PendingSignup,
} from '@/modules/accounts'

import { clientIp, sessionCookie } from '../../http'
import { backPath, clearedOAuthCookie, redirectTo, requestUrl, signupCookie } from '../http'

export const dynamic = 'force-dynamic'

const byIp = sharedRateLimiter({
  name: 'auth.yandex_callback.ip',
  limit: 30,
  windowMs: 10 * 60_000,
})

/**
 * GET /api/auth/yandex/callback?code&state — возврат с Яндекса (T-056). Проверки по порядку:
 * redirect URI (хост и путь — как в YANDEX_REDIRECT_URI), `state` из зашифрованной cookie
 * (подделка, чужая или старая вкладка — отказ), отказ зрителя на экране Яндекса, обмен кода
 * server-to-server (client_secret + PKCE verifier), профиль: токен нашего приложения,
 * подтверждённая почта. Дальше: привязка (из профиля) или вход; нового покупателя без согласия
 * не создаём — на /register/yandex. Ответ всегда 303 на страницу сайта; ошибка — `?yandex=<код>`:
 * unavailable | too_many | redirect_mismatch | state | denied | email_unverified | failed (и для
 * привязки taken | already_linked | linked). Cookie шага стирается при любом исходе.
 */
export const GET = withCorrelation('auth.yandex_callback', async (req: NextRequest, ctx) => {
  const clear = clearedOAuthCookie()
  const config = yandexConfig()
  if (!config) return redirectTo('/login?yandex=unavailable', [clear])
  if (!(await byIp.hit(clientIp(req)))) return redirectTo('/login?yandex=too_many', [clear])

  const saved = unseal<OAuthState>(config.cookieKey, req.cookies.get(OAUTH_COOKIE)?.value)
  const back = backPath(saved?.mode)
  const checked = checkCallback(config, { requestUrl: requestUrl(req), saved })
  if (!checked.ok) {
    ctx.log.warn('auth.yandex_rejected', { reason: checked.error })
    return redirectTo(`${back}?yandex=${checked.error}`, [clear])
  }
  const fetched = await fetchYandexProfile(config, {
    code: checked.code,
    verifier: checked.saved.verifier,
  })
  if (!fetched.ok) {
    ctx.log.warn('auth.yandex_rejected', { reason: fetched.error })
    return redirectTo(`${back}?yandex=${fetched.error}`, [clear])
  }
  const profile = fetched.profile

  try {
    const { auth } = await getAccounts()
    if (checked.saved.mode === 'link') {
      // Привязывает тот же покупатель, что начинал: сессия могла смениться за это время.
      const session = await auth.getSession(req.cookies.get(SESSION_COOKIE)?.value)
      if (!session || session.customer.id !== checked.saved.customerId)
        return redirectTo('/login?next=/account&yandex=state', [clear])
      const linked = await auth.linkIdentity(session.customer.id, profile)
      ctx.log.info('auth.yandex_link', { outcome: linked.ok ? 'linked' : linked.error })
      return redirectTo(`/account?yandex=${linked.ok ? 'linked' : linked.error}#profile`, [clear])
    }

    const result = await auth.externalSignIn(profile)
    if (result.ok) {
      ctx.log.info('auth.yandex_signed_in')
      return redirectTo(checked.saved.next, [
        clear,
        sessionCookie(result.session.token, result.session.expiresAt),
      ])
    }
    // Новый зритель: сначала согласие на обработку ПД (152-ФЗ), потом аккаунт.
    const pending: PendingSignup = { profile, next: checked.saved.next, ref: checked.saved.ref }
    return redirectTo('/register/yandex', [
      clear,
      signupCookie(seal(config.cookieKey, pending, SIGNUP_TTL_SEC)),
    ])
  } catch (error) {
    ctx.log.error('auth.unavailable', { error: errorInfo(error) })
    return redirectTo(`${back}?yandex=failed`, [clear])
  }
})
