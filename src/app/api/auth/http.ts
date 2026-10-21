import type { NextRequest } from 'next/server'

import { EmailNotConfiguredError, SESSION_COOKIE } from '@/modules/accounts'

/** Изменяющие запросы с cookie-сессией — только со своего сайта (CSRF, rules.md). */
export const sameOrigin = (req: NextRequest) => {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).host === req.headers.get('host')
  } catch {
    return false
  }
}

/** IP клиента за обратным прокси (Caddy ставит X-Forwarded-For). */
export const clientIp = (req: NextRequest) =>
  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })

export const sessionCookie = (token: string, expires: Date) =>
  [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expires.toUTCString()}`,
    ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
  ].join('; ')

export const clearedSessionCookie = () =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`

/**
 * Обёртка маршрутов входа: недоступная база или почта — понятный 503, а не 500 и не зависание.
 * В лог — только тип ошибки (без почты, кодов и токенов).
 */
export const guarded =
  (handler: (req: NextRequest) => Promise<Response>) =>
  async (req: NextRequest): Promise<Response> => {
    try {
      return await handler(req)
    } catch (error) {
      if (error instanceof EmailNotConfiguredError) return json({ error: 'email_unavailable' }, 503)
      console.error('[auth] unavailable:', error instanceof Error ? error.name : 'unknown')
      return json({ error: 'unavailable' }, 503)
    }
  }
