import type { NextRequest } from 'next/server'

import { apiError, withCorrelation, type RequestContext } from '@/lib/correlation'
import { errorInfo } from '@/lib/log'
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
 * Обёртка маршрутов входа и кабинета (T-015): correlation ID (`withCorrelation`), ошибки —
 * `{code, message, correlationId}`; недоступная база или почта — понятный 503, а не 500 и не
 * зависание. В лог — только тип ошибки (без почты, кодов и токенов).
 */
export const guarded = (
  route: string,
  handler: (req: NextRequest, ctx: RequestContext) => Promise<Response>,
) =>
  withCorrelation(route, async (req: NextRequest, ctx) => {
    try {
      return await handler(req, ctx)
    } catch (error) {
      if (error instanceof EmailNotConfiguredError)
        return apiError(
          503,
          'email_unavailable',
          'Отправка писем пока не настроена.',
          ctx.correlationId,
        )
      ctx.log.error('auth.unavailable', { error: errorInfo(error) })
      return apiError(
        503,
        'unavailable',
        'Сервис временно недоступен. Попробуйте позже.',
        ctx.correlationId,
      )
    }
  })

/** Короткие ответы-ошибки маршрутов кабинета (тексты — для поддержки, форма показывает свои). */
export const fail = {
  forbidden: (ctx: RequestContext) =>
    apiError(403, 'forbidden', 'Запрос не с сайта театра.', ctx.correlationId),
  tooMany: (ctx: RequestContext, retryAfter?: number) =>
    apiError(
      429,
      'too_many',
      'Слишком много попыток. Подождите несколько минут.',
      ctx.correlationId,
      retryAfter ? { 'Retry-After': String(retryAfter) } : {},
      retryAfter ? { retryAfter } : {},
    ),
  invalid: (ctx: RequestContext, extra: Record<string, unknown> = {}) =>
    apiError(400, 'invalid', 'Проверьте введённые данные.', ctx.correlationId, {}, extra),
  unauthorized: (ctx: RequestContext, headers: Record<string, string> = {}) =>
    apiError(401, 'unauthorized', 'Войдите в личный кабинет.', ctx.correlationId, headers),
}
