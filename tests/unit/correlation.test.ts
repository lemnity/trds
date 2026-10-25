import { describe, expect, it } from 'vitest'

import { apiError, correlationIdFrom, withCorrelation } from '../../src/lib/correlation'
import { createLogger } from '../../src/lib/log'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('correlationIdFrom', () => {
  it('reuses a well-formed incoming x-request-id', () => {
    expect(correlationIdFrom(new Headers({ 'x-request-id': 'caddy-1234abcd' }))).toBe(
      'caddy-1234abcd',
    )
  })

  it('replaces a missing or unsafe header with a fresh UUID', () => {
    expect(correlationIdFrom(new Headers())).toMatch(UUID)
    expect(correlationIdFrom(new Headers({ 'x-request-id': 'a"b {evil} <script>' }))).toMatch(UUID)
    expect(correlationIdFrom(new Headers({ 'x-request-id': 'short' }))).toMatch(UUID)
  })
})

describe('withCorrelation', () => {
  const setup = () => {
    const lines: string[] = []
    const logger = createLogger({ level: 'debug', write: (l) => lines.push(l) })
    return { lines, logger }
  }

  it('echoes the id in the response and passes it to the handler log', async () => {
    const { lines, logger } = setup()
    const handler = withCorrelation(
      'test.route',
      async (_req, { correlationId, log }) => {
        log.info('handled')
        return Response.json({ correlationId })
      },
      logger,
    )
    const res = await handler(
      new Request('http://x/api', { headers: { 'x-request-id': 'req-00000001' } }),
    )
    expect(res.headers.get('x-request-id')).toBe('req-00000001')
    expect(await res.json()).toEqual({ correlationId: 'req-00000001' })
    expect(JSON.parse(lines[0]!)).toMatchObject({
      correlationId: 'req-00000001',
      route: 'test.route',
    })
  })

  it('turns an unhandled error into the standard error body without details', async () => {
    const { lines, logger } = setup()
    const handler = withCorrelation(
      'test.route',
      async () => {
        throw new Error('relation "orders" does not exist; user anna@example.ru')
      },
      logger,
    )
    const res = await handler(new Request('http://x/api'))
    expect(res.status).toBe(500)
    const body = (await res.json()) as Record<string, string>
    expect(Object.keys(body).sort()).toEqual(['code', 'correlationId', 'message'])
    expect(body.correlationId).toBe(res.headers.get('x-request-id'))
    expect(JSON.stringify(body) + lines.join('')).not.toMatch(/orders|anna/)
  })

  it('keeps redirect responses with immutable headers intact', async () => {
    const handler = withCorrelation(
      'r',
      async () => Response.redirect('http://x/ok', 302),
      setup().logger,
    )
    const res = await handler(new Request('http://x/api'))
    expect(res.status).toBe(302)
  })
})

describe('apiError', () => {
  it('uses the {code, message, correlationId} format and no-store', async () => {
    const res = apiError(400, 'invalid_input', 'Проверьте поля формы', 'req-00000002')
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({
      code: 'invalid_input',
      message: 'Проверьте поля формы',
      correlationId: 'req-00000002',
    })
  })
})
