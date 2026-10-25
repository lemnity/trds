import type { NextRequest } from 'next/server'

import {
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  OAUTH_TTL_SEC,
  SIGNUP_COOKIE,
  SIGNUP_TTL_SEC,
  type OAuthMode,
} from '@/modules/accounts'

/** Cookie шагов входа через Яндекс (T-056): HttpOnly, SameSite=Lax — возврат с Яндекса — переход верхнего уровня. */
const cookie = (name: string, value: string, path: string, maxAge: number) =>
  [
    `${name}=${value}`,
    `Path=${path}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
  ].join('; ')

export const oauthCookie = (sealed: string) =>
  cookie(OAUTH_COOKIE, sealed, OAUTH_COOKIE_PATH, OAUTH_TTL_SEC)
export const clearedOAuthCookie = () => cookie(OAUTH_COOKIE, '', OAUTH_COOKIE_PATH, 0)
export const signupCookie = (sealed: string) => cookie(SIGNUP_COOKIE, sealed, '/', SIGNUP_TTL_SEC)
export const clearedSignupCookie = () => cookie(SIGNUP_COOKIE, '', '/', 0)

/**
 * Переход браузера (303). Адрес — путь своего сайта (относительный Location) или страница
 * авторизации Яндекса; несколько Set-Cookie — отдельными заголовками.
 */
export const redirectTo = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' })
  for (const c of cookies) headers.append('Set-Cookie', c)
  return new Response(null, { status: 303, headers })
}

/** Добавить Set-Cookie к готовому ответу (JSON-ответы с несколькими cookie). */
export const withCookies = (response: Response, cookies: string[]) => {
  for (const c of cookies) response.headers.append('Set-Cookie', c)
  return response
}

/** Страница, куда вернуть ошибку шага: откуда зритель начинал. */
export const backPath = (mode: OAuthMode | undefined) =>
  mode === 'link' ? '/account' : mode === 'register' ? '/register' : '/login'

/** Адрес, на который пришёл браузер: хост — из заголовка Host (его передаёт Caddy). */
export const requestUrl = (req: NextRequest) =>
  new URL(
    `${req.nextUrl.pathname}${req.nextUrl.search}`,
    `http://${req.headers.get('host') ?? req.nextUrl.host}`,
  )
