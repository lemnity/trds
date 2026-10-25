import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

// Маршруты кабинета, входа, заявок и бонусов на withCorrelation (T-015): `x-request-id` в ответе,
// ошибки — `{code, message, correlationId}`, коды — прежние строки `error` (формы их понимают).
const holder = vi.hoisted(() => ({ fail: false }))

vi.mock('@/modules/accounts', () => ({
  SESSION_COOKIE: 'turdus_session',
  PASSWORD_MAX: 128,
  EmailNotConfiguredError: class EmailNotConfiguredError extends Error {},
  getAccounts: async () => {
    if (holder.fail) throw new Error('connect ECONNREFUSED 10.0.0.5:5432 user=trds')
    return {
      auth: {
        getSession: async () => null,
        passwordLogin: async () => ({ ok: false, error: 'invalid' }),
        requestCode: async () => ({ ok: false, error: 'cooldown', retryAfter: 42 }),
      },
      consent: async () => undefined,
    }
  },
}))
vi.mock('@/modules/lead-requests', () => ({
  getLeadRequests: async () => ({
    submit: async () => ({ ok: false, error: 'invalid', fields: { email: 'Проверьте почту' } }),
  }),
}))
vi.mock('@/modules/wallet', () => ({
  attachReferralOnSignup: async () => 'skipped',
  getWallet: async () => ({}),
}))

const { POST: passwordLogin } = await import('../../src/app/api/auth/password/route')
const { POST: requestCode } = await import('../../src/app/api/auth/email-code/request/route')
const { GET: session } = await import('../../src/app/api/auth/session/route')
const { DELETE: sessions } = await import('../../src/app/api/account/sessions/route')
const { POST: leads } = await import('../../src/app/api/leads/route')
const { GET: summary } = await import('../../src/app/api/loyalty/summary/route')

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      host: 'localhost',
      origin: 'http://localhost',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })

const errorBody = (code: string) => ({
  code,
  message: expect.any(String),
  correlationId: expect.any(String),
})

describe('migrated routes: correlation id and error format', () => {
  it('echoes a valid incoming x-request-id and puts it in the error body', async () => {
    const res = await passwordLogin(
      post(
        '/api/auth/password',
        { email: 'a@t.ru', password: 'x' },
        { 'x-request-id': 'support-1234' },
      ),
    )
    expect(res.status).toBe(400)
    expect(res.headers.get('x-request-id')).toBe('support-1234')
    expect(await res.json()).toEqual({ ...errorBody('invalid'), correlationId: 'support-1234' })
  })

  it('403 forbidden from another origin, same codes as before', async () => {
    const res = await passwordLogin(
      post('/api/auth/password', {}, { origin: 'https://evil.example' }),
    )
    expect(res.status).toBe(403)
    expect(res.headers.get('x-request-id')).toBeTruthy()
    expect(await res.json()).toEqual(errorBody('forbidden'))
  })

  it('429 cooldown keeps retryAfter in the body and the Retry-After header', async () => {
    const res = await requestCode(
      post('/api/auth/email-code/request', { purpose: 'login', email: 'a@t.ru' }),
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('42')
    expect(await res.json()).toEqual({ ...errorBody('cooldown'), retryAfter: 42 })
  })

  it('401 for a missing session; 400 lead with its field errors', async () => {
    const del = await sessions(
      new NextRequest('http://localhost/api/account/sessions', {
        method: 'DELETE',
        headers: { host: 'localhost', origin: 'http://localhost' },
      }),
    )
    expect(del.status).toBe(401)
    expect(await del.json()).toEqual(errorBody('unauthorized'))
    const lead = await leads(post('/api/leads', { idempotencyKey: 'k', lead: {} }))
    expect(lead.status).toBe(400)
    expect(await lead.json()).toEqual({
      ...errorBody('invalid'),
      fields: { email: 'Проверьте почту' },
    })
    const loyalty = await summary(new NextRequest('http://localhost/api/loyalty/summary'))
    expect(loyalty.status).toBe(401)
    expect(loyalty.headers.get('x-request-id')).toBeTruthy()
  })

  it('database down: 503 unavailable without details; session keeps customer: null', async () => {
    holder.fail = true
    try {
      const res = await passwordLogin(
        post('/api/auth/password', { email: 'a@t.ru', password: 'x' }),
      )
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body).toEqual(errorBody('unavailable'))
      expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|5432|trds/)
      const s = await session(new NextRequest('http://localhost/api/auth/session'))
      expect(s.status).toBe(503)
      expect(await s.json()).toMatchObject({ customer: null, code: 'unavailable' })
    } finally {
      holder.fail = false
    }
  })
})
