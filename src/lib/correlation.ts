import { randomUUID } from 'node:crypto'

import { log as rootLog, type Logger } from './log'

/**
 * Correlation ID для API-маршрутов (T-015, rules.md §4, §6). Берётся из входящего `x-request-id`
 * (его может поставить Caddy или клиент поддержки), иначе создаётся; возвращается в ответе тем же
 * заголовком и попадает в каждую строку лога и в тело ошибки — по нему находят запрос в логах.
 *
 * Как подключить маршрут: `export const POST = withCorrelation('auth.login', async (req, ctx) => …)`;
 * внутри — `ctx.log` и `apiError(…, ctx.correlationId)`. Маршруты кабинета и входа оборачивает
 * `guarded` (src/app/api/auth/http.ts) — тот же withCorrelation плюс 503 при недоступной базе/почте.
 */

export const REQUEST_ID_HEADER = 'x-request-id'

// Чужой заголовок попадает в логи: только короткий безопасный набор символов.
const VALID_ID = /^[A-Za-z0-9._:-]{8,128}$/

export const correlationIdFrom = (headers: Headers): string => {
  const incoming = headers.get(REQUEST_ID_HEADER)?.trim()
  return incoming && VALID_ID.test(incoming) ? incoming : randomUUID()
}

/**
 * Единый формат ошибки API: `{code, message, correlationId}` без stack trace и деталей БД.
 * `extra` — безопасные поля для формы (`retryAfter`, `fields`); основные поля они не перекрывают.
 */
export const apiError = (
  status: number,
  code: string,
  message: string,
  correlationId: string,
  headers: Record<string, string> = {},
  extra: Record<string, unknown> = {},
) =>
  Response.json(
    { ...extra, code, message, correlationId },
    {
      status,
      headers: { 'Cache-Control': 'no-store', [REQUEST_ID_HEADER]: correlationId, ...headers },
    },
  )

export type RequestContext = { correlationId: string; log: Logger }

type Handler<R extends Request> = (req: R, ctx: RequestContext) => Promise<Response>

/**
 * Обёртка route handler: correlation ID, логгер с ним, заголовок в ответе и безопасный 500
 * на непойманную ошибку (в лог — только тип ошибки).
 */
export const withCorrelation =
  <R extends Request>(route: string, handler: Handler<R>, logger: Logger = rootLog) =>
  async (req: R): Promise<Response> => {
    const correlationId = correlationIdFrom(req.headers)
    const log = logger.child({ correlationId, route })
    let response: Response
    try {
      response = await handler(req, { correlationId, log })
    } catch (error) {
      log.error('api.unhandled_error', { error })
      return apiError(500, 'internal_error', 'Внутренняя ошибка. Повторите позже.', correlationId)
    }
    try {
      response.headers.set(REQUEST_ID_HEADER, correlationId)
    } catch {
      // У Response.redirect() заголовки неизменяемы — ответ отдаём как есть.
    }
    return response
  }
