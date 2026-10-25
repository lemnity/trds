import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

import type { ExternalProfile } from './service'

/**
 * Вход через Яндекс ID (T-056, plan-main §6.2 п.3): OAuth 2.0 Authorization Code + PKCE (S256)
 * через oauth.yandex.ru, профиль — login.yandex.ru/info. Только сервер: `client_secret` не уходит
 * в браузер, обмен кода — server-to-server. Защита: `state` в зашифрованной HttpOnly cookie
 * (CSRF), redirect URI — только из настроек (и проверяется при возврате), токен должен быть выдан
 * нашему приложению (`client_id` в профиле), почта — только подтверждённая Яндексом.
 * Без YANDEX_CLIENT_ID / YANDEX_CLIENT_SECRET / YANDEX_REDIRECT_URI вход выключен.
 */

export const YANDEX = {
  authorizeUrl: 'https://oauth.yandex.ru/authorize',
  tokenUrl: 'https://oauth.yandex.ru/token',
  infoUrl: 'https://login.yandex.ru/info?format=json',
  /** Права приложения: почта и имя (их же театр отмечает при регистрации приложения). */
  scope: 'login:email login:info',
  callbackPath: '/api/auth/yandex/callback',
  timeoutMs: 5000,
} as const

/** Cookie шага OAuth: state, verifier, режим; живёт 10 минут и только на /api/auth/yandex. */
export const OAUTH_COOKIE = 'turdus_oauth'
export const OAUTH_COOKIE_PATH = '/api/auth/yandex'
export const OAUTH_TTL_SEC = 10 * 60
/** Cookie подтверждения регистрации (почта и имя из Яндекса до согласия на обработку ПД). */
export const SIGNUP_COOKIE = 'turdus_oauth_signup'
export const SIGNUP_TTL_SEC = 15 * 60

export type YandexConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
  /** Ключ шифрования cookie OAuth (из PAYLOAD_SECRET, своя метка). */
  cookieKey: Buffer
}

type Env = Record<string, string | undefined>

/**
 * Настройки из env или null — вход через Яндекс выключен. Redirect URI — ровно наш callback;
 * в production — только https. Ошибка настройки не роняет сайт: кнопка просто не показывается.
 */
export function yandexConfig(env: Env = process.env): YandexConfig | null {
  const clientId = env.YANDEX_CLIENT_ID?.trim()
  const clientSecret = env.YANDEX_CLIENT_SECRET?.trim()
  const redirectUri = env.YANDEX_REDIRECT_URI?.trim()
  if (!clientId || !clientSecret || !redirectUri) return null
  let url: URL
  try {
    url = new URL(redirectUri)
  } catch {
    return null
  }
  const production = env.NODE_ENV === 'production'
  if (url.pathname !== YANDEX.callbackPath || url.search || url.hash) return null
  if (url.protocol !== 'https:' && (production || url.protocol !== 'http:')) return null
  const secret = env.PAYLOAD_SECRET ?? ''
  if (secret.length < 32 && production) return null
  return {
    clientId,
    clientSecret,
    redirectUri: url.toString(),
    cookieKey: createHmac('sha256', secret || 'dev')
      .update('turdus:oauth')
      .digest(),
  }
}

// --- Зашифрованные cookie (AES-256-GCM): подделать или прочитать без ключа нельзя. ---

export function seal(key: Buffer, payload: object, ttlSec: number, now = Date.now()): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([
    cipher.update(JSON.stringify({ ...payload, exp: now + ttlSec * 1000 }), 'utf8'),
    cipher.final(),
  ])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}

export function unseal<T>(key: Buffer, value: string | undefined, now = Date.now()): T | null {
  if (!value || value.length > 4096) return null
  try {
    const raw = Buffer.from(value, 'base64url')
    if (raw.length < 29) return null
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString()
    const data = JSON.parse(text) as T & { exp?: number }
    return typeof data.exp === 'number' && data.exp > now ? data : null
  } catch {
    return null
  }
}

// --- Шаг 1: переход на Яндекс. ---

/** `login` и `register` ведут себя одинаково (решает наличие аккаунта); различается, куда вернуть ошибку. */
export type OAuthMode = 'login' | 'register' | 'link'

/** Содержимое cookie шага OAuth. */
export type OAuthState = {
  state: string
  verifier: string
  mode: OAuthMode
  next: string
  ref: string | null
  /** Для привязки — кто начинал (сверяется с сессией на возврате). */
  customerId: string | null
}

/** Куда вернуть после входа: только путь своего сайта, иначе — кабинет. */
export function safeNext(next: string | null | undefined): string {
  if (!next || next.length > 512) return '/account'
  if (!next.startsWith('/') || next.startsWith('//') || /[\\\u0000-\u001f]/.test(next))
    return '/account'
  return next
}

export function startOAuth(
  config: YandexConfig,
  input: { mode: OAuthMode; next?: string | null; ref?: string | null; customerId?: string | null },
): { url: string; state: OAuthState } {
  const state: OAuthState = {
    state: randomBytes(32).toString('base64url'),
    // RFC 7636: 43–128 символов; 32 случайных байта → 43 символа base64url.
    verifier: randomBytes(32).toString('base64url'),
    mode: input.mode,
    next: safeNext(input.next),
    ref: input.ref ?? null,
    customerId: input.customerId ?? null,
  }
  const url = new URL(YANDEX.authorizeUrl)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: YANDEX.scope,
    state: state.state,
    code_challenge: createHash('sha256').update(state.verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString()
  return { url: url.toString(), state }
}

// --- Шаг 2: возврат с Яндекса. ---

export type CallbackError =
  /** Вход через Яндекс выключен (нет настроек). */
  | 'unavailable'
  /** Возврат не на наш redirect URI (другой хост/путь). */
  | 'redirect_mismatch'
  /** Нет/истекла cookie шага или `state` не совпал — подделка или старая вкладка. */
  | 'state'
  /** Зритель отказался на экране Яндекса. */
  | 'denied'
  /** Яндекс не подтвердил почту (или не дал доступ к ней). */
  | 'email_unverified'
  /** Яндекс не ответил / ответил ошибкой. */
  | 'failed'

const sameText = (a: string, b: string) => {
  const x = createHash('sha256').update(a).digest()
  const y = createHash('sha256').update(b).digest()
  return timingSafeEqual(x, y)
}

/**
 * Проверка возврата до обмена кода: наш ли адрес, совпадает ли `state` с cookie, не отказался ли
 * зритель. `requestUrl` — адрес, на который пришёл браузер (хост из заголовка Host).
 */
export function checkCallback(
  config: YandexConfig,
  input: { requestUrl: URL; saved: OAuthState | null },
): { ok: true; code: string; saved: OAuthState } | { ok: false; error: CallbackError } {
  const expected = new URL(config.redirectUri)
  if (input.requestUrl.host !== expected.host || input.requestUrl.pathname !== expected.pathname)
    return { ok: false, error: 'redirect_mismatch' }
  const params = input.requestUrl.searchParams
  const state = params.get('state')
  if (!input.saved || !state || !sameText(state, input.saved.state))
    return { ok: false, error: 'state' }
  const error = params.get('error')
  if (error) return { ok: false, error: error === 'access_denied' ? 'denied' : 'failed' }
  const code = params.get('code')
  if (!code || code.length > 256) return { ok: false, error: 'failed' }
  return { ok: true, code, saved: input.saved }
}

type Fetch = typeof fetch

/** Профиль login.yandex.ru/info (только нужные поля). */
export type YandexInfo = {
  id?: unknown
  client_id?: unknown
  default_email?: unknown
  emails?: unknown
  real_name?: unknown
  display_name?: unknown
}

/**
 * Обмен кода на токен (server-to-server, `client_secret` + PKCE verifier) и профиль. Без повторов
 * обмена: код одноразовый. Профиль — одна повторная попытка при сетевой ошибке/5xx. Токен нигде
 * не сохраняется: он нужен только чтобы прочитать профиль.
 */
export async function fetchYandexProfile(
  config: YandexConfig,
  input: { code: string; verifier: string },
  fetchImpl: Fetch = fetch,
): Promise<{ ok: true; profile: ExternalProfile } | { ok: false; error: CallbackError }> {
  let token: string
  try {
    const res = await fetchImpl(YANDEX.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code_verifier: input.verifier,
      }).toString(),
      signal: AbortSignal.timeout(YANDEX.timeoutMs),
    })
    const data = (await res.json().catch(() => null)) as { access_token?: unknown } | null
    if (!res.ok || typeof data?.access_token !== 'string') return { ok: false, error: 'failed' }
    token = data.access_token
  } catch {
    return { ok: false, error: 'failed' }
  }

  let info: YandexInfo | null = null
  for (let attempt = 0; attempt < 2 && !info; attempt++) {
    try {
      const res = await fetchImpl(YANDEX.infoUrl, {
        headers: { Authorization: `OAuth ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(YANDEX.timeoutMs),
      })
      if (res.ok) info = (await res.json().catch(() => null)) as YandexInfo | null
      if (!info && res.status < 500) break
    } catch {
      // Сетевая ошибка — ещё одна попытка.
    }
    if (!info && attempt === 0) await new Promise((r) => setTimeout(r, 300))
  }
  if (!info) return { ok: false, error: 'failed' }
  return profileFromInfo(config, info)
}

/**
 * Профиль → данные покупателя. Почта — `default_email`, и только если Яндекс перечисляет её
 * в `emails` (подтверждённые адреса аккаунта); иначе вход не связываем ни с каким аккаунтом.
 */
export function profileFromInfo(
  config: YandexConfig,
  info: YandexInfo,
): { ok: true; profile: ExternalProfile } | { ok: false; error: CallbackError } {
  // Токен, выданный чужому приложению, не принимаем (подмена токена).
  if (info.client_id !== config.clientId) return { ok: false, error: 'failed' }
  const subject = typeof info.id === 'string' || typeof info.id === 'number' ? String(info.id) : ''
  if (!/^[\w-]{1,64}$/.test(subject)) return { ok: false, error: 'failed' }
  const email =
    typeof info.default_email === 'string' ? info.default_email.trim().toLowerCase() : ''
  const confirmed = Array.isArray(info.emails)
    ? info.emails.filter((e): e is string => typeof e === 'string').map((e) => e.toLowerCase())
    : []
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, error: 'email_unverified' }
  if (!confirmed.includes(email)) return { ok: false, error: 'email_unverified' }
  const rawName =
    typeof info.real_name === 'string' && info.real_name.trim()
      ? info.real_name
      : typeof info.display_name === 'string'
        ? info.display_name
        : ''
  const name = rawName.trim().slice(0, 100) || null
  return { ok: true, profile: { provider: 'yandex', subject, email, name } }
}

/** Ожидающая регистрация через Яндекс (до согласия на обработку ПД). */
export type PendingSignup = {
  profile: ExternalProfile
  next: string
  ref: string | null
}
