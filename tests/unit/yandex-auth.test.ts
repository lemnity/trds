import { createHash } from 'node:crypto'

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  yandexCompleteError,
  yandexLinkNotice,
  yandexSignInNotice,
} from '../../src/components/auth/yandex-view'
import {
  createAuthService,
  memoryAuthStore,
  type AuthService,
} from '../../src/modules/accounts/service'
import {
  profileFromInfo,
  safeNext,
  seal,
  unseal,
  yandexConfig,
  type YandexConfig,
} from '../../src/modules/accounts/yandex'

// Вход через Яндекс ID (T-056): маршруты целиком, Яндекс — подделка fetch, кабинет — настоящий
// сервис на хранилище в памяти.
const holder = vi.hoisted(() => ({
  auth: null as AuthService | null,
  store: null as ReturnType<typeof memoryAuthStore> | null,
  consents: [] as string[],
  attach: vi.fn(),
}))

vi.mock('@/modules/accounts', async () => {
  const service = await import('../../src/modules/accounts/service')
  const yandex = await import('../../src/modules/accounts/yandex')
  return {
    ...yandex,
    OTP_RULES: service.OTP_RULES,
    PASSWORD_MAX: service.PASSWORD_MAX,
    SESSION_COOKIE: 'turdus_session',
    EmailNotConfiguredError: class EmailNotConfiguredError extends Error {},
    getAccounts: async () => ({
      auth: holder.auth!,
      consent: async (email: string, context: string) => {
        holder.consents.push(`${email}:${context}`)
      },
    }),
  }
})

vi.mock('@/modules/wallet', async () => {
  const signup = await import('../../src/modules/wallet/signup')
  return {
    attachReferralOnSignup: signup.attachReferralOnSignup,
    getWallet: async () => ({ attachReferral: holder.attach }),
  }
})

const { POST: start } = await import('../../src/app/api/auth/yandex/start/route')
const { GET: callback } = await import('../../src/app/api/auth/yandex/callback/route')
const { POST: complete } = await import('../../src/app/api/auth/yandex/complete/route')
const { DELETE: unlink } = await import('../../src/app/api/auth/yandex/link/route')
const { GET: providers } = await import('../../src/app/api/auth/providers/route')

const HOST = 'teatrturdus.ru'
const SITE = `https://${HOST}`
const ENV = {
  YANDEX_CLIENT_ID: 'turdus-client-id',
  YANDEX_CLIENT_SECRET: 'super-secret-value',
  YANDEX_REDIRECT_URI: `${SITE}/api/auth/yandex/callback`,
  PAYLOAD_SECRET: 'test-payload-secret-0123456789abcdef',
}

type Info = Record<string, unknown>
const yandexUser = (over: Info = {}): Info => ({
  id: '1000123',
  client_id: ENV.YANDEX_CLIENT_ID,
  login: 'anna',
  default_email: 'anna@yandex.ru',
  emails: ['anna@yandex.ru'],
  real_name: 'Анна Слепых',
  ...over,
})

// --- Подделка Яндекса: токен по коду, профиль по токену. ---
let info: Info = yandexUser()
let calls: { url: string; init?: RequestInit }[] = []
const fakeYandex = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  calls.push({ url, init })
  if (url === 'https://oauth.yandex.ru/token') {
    const form = new URLSearchParams(String(init?.body))
    if (form.get('code') !== 'good-code')
      return Response.json({ error: 'bad_verification_code' }, { status: 400 })
    return Response.json({ access_token: 'yandex-access-token', token_type: 'bearer' })
  }
  if (url.startsWith('https://login.yandex.ru/info')) return Response.json(info)
  return new Response('not found', { status: 404 })
})

const cookieValue = (res: Response, name: string) => {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';')
    const [key, ...rest] = pair!.split('=')
    if (key === name) return { value: rest.join('='), line }
  }
  return null
}

const startFlow = (fields: Record<string, string>, cookie?: string, origin = SITE) =>
  start(
    new NextRequest(`${SITE}/api/auth/yandex/start`, {
      method: 'POST',
      headers: {
        host: HOST,
        origin,
        'content-type': 'application/x-www-form-urlencoded',
        ...(cookie && { cookie }),
      },
      body: new URLSearchParams(fields).toString(),
    }),
  )

const callbackReq = (query: string, cookie?: string, host = HOST) =>
  callback(
    new NextRequest(`https://${host}/api/auth/yandex/callback?${query}`, {
      headers: { host, ...(cookie && { cookie }) },
    }),
  )

/** Полный переход: start → (Яндекс) → callback с выданным state. */
const signInWithYandex = async (fields: Record<string, string> = {}, session?: string) => {
  const started = await startFlow(
    { mode: 'login', ...fields },
    session ? `turdus_session=${session}` : undefined,
  )
  const location = new URL(started.headers.get('location')!)
  const oauth = cookieValue(started, 'turdus_oauth')!.value
  const cookie = [`turdus_oauth=${oauth}`, ...(session ? [`turdus_session=${session}`] : [])]
  return callbackReq(
    `code=good-code&state=${location.searchParams.get('state')}`,
    cookie.join('; '),
  )
}

const completeSignup = (signupCookie: string, consent: unknown = true, origin = SITE) =>
  complete(
    new NextRequest(`${SITE}/api/auth/yandex/complete`, {
      method: 'POST',
      headers: {
        host: HOST,
        origin,
        'content-type': 'application/json',
        cookie: `turdus_oauth_signup=${signupCookie}`,
      },
      body: JSON.stringify({ consent }),
    }),
  )

/** Покупатель, вошедший кодом из письма: id и токен сессии. */
const emailCustomer = async (email: string) => {
  await holder.auth!.requestCode({ email, purpose: 'login' })
  const r = await holder.auth!.verifyCode({ email, code: '123456' })
  if (!r.ok) throw new Error('login failed')
  return { id: r.customer.id, token: r.session.token }
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v)
  vi.stubGlobal('fetch', fakeYandex)
  info = yandexUser()
  calls = []
  fakeYandex.mockClear()
  holder.attach.mockReset()
  holder.attach.mockResolvedValue({ ok: true })
  holder.consents = []
  holder.store = memoryAuthStore()
  holder.auth = createAuthService({
    store: holder.store,
    secret: 'otp-secret-otp-secret-otp-secret-123',
    sendCode: async () => undefined,
    randomCode: () => '123456',
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('yandexConfig', () => {
  it('is off unless id, secret and redirect URI are all set', () => {
    expect(yandexConfig({ ...ENV, YANDEX_CLIENT_SECRET: '' })).toBeNull()
    expect(yandexConfig({ ...ENV, YANDEX_CLIENT_ID: undefined })).toBeNull()
    expect(yandexConfig({ ...ENV, YANDEX_REDIRECT_URI: '  ' })).toBeNull()
    expect(yandexConfig(ENV)).toMatchObject({ clientId: 'turdus-client-id' })
  })

  it('accepts only our callback path, https in production', () => {
    const at = (uri: string, NODE_ENV = 'production') =>
      yandexConfig({ ...ENV, NODE_ENV, YANDEX_REDIRECT_URI: uri })
    expect(at(`${SITE}/api/auth/yandex/other`)).toBeNull()
    expect(at(`${SITE}/api/auth/yandex/callback?x=1`)).toBeNull()
    expect(at(`http://${HOST}/api/auth/yandex/callback`)).toBeNull()
    expect(at('http://localhost:3020/api/auth/yandex/callback', 'development')).not.toBeNull()
    expect(at('javascript:alert(1)', 'development')).toBeNull()
  })
})

describe('disabled without credentials', () => {
  beforeEach(() => vi.stubEnv('YANDEX_CLIENT_SECRET', ''))

  it('hides the button and refuses every step honestly', async () => {
    expect(await (await providers(new Request(`${SITE}/api/auth/providers`))).json()).toEqual({
      yandex: false,
    })
    const started = await startFlow({ mode: 'register' })
    expect(started.status).toBe(303)
    expect(started.headers.get('location')).toBe('/register?yandex=unavailable')
    const back = await callbackReq('code=good-code&state=x')
    expect(back.headers.get('location')).toBe('/login?yandex=unavailable')
    expect(fakeYandex).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth/yandex/start', () => {
  it('redirects to Yandex with state, S256 PKCE and the configured redirect URI only', async () => {
    const res = await startFlow({ mode: 'login', redirect_uri: 'https://evil.example/cb' })
    expect(res.status).toBe(303)
    expect(res.headers.get('x-request-id')).toBeTruthy()
    const url = new URL(res.headers.get('location')!)
    expect(url.origin + url.pathname).toBe('https://oauth.yandex.ru/authorize')
    const q = url.searchParams
    expect(q.get('response_type')).toBe('code')
    expect(q.get('client_id')).toBe(ENV.YANDEX_CLIENT_ID)
    expect(q.get('redirect_uri')).toBe(ENV.YANDEX_REDIRECT_URI)
    expect(q.get('scope')).toBe('login:email login:info')
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('state')).toMatch(/^[\w-]{43}$/)
    // Секрет приложения в браузер не уходит.
    expect(res.headers.get('location')).not.toContain(ENV.YANDEX_CLIENT_SECRET)

    const oauth = cookieValue(res, 'turdus_oauth')!
    expect(oauth.line).toMatch(/HttpOnly/)
    expect(oauth.line).toMatch(/SameSite=Lax/)
    expect(oauth.line).toMatch(/Path=\/api\/auth\/yandex/)
    expect(oauth.line).toMatch(/Max-Age=600/)
    // В cookie — шифр: state и verifier не читаются без ключа сервера.
    expect(oauth.value).not.toContain(q.get('state'))
    const saved = unseal<{ state: string; verifier: string }>(
      yandexConfig(ENV)!.cookieKey,
      oauth.value,
    )!
    expect(saved.state).toBe(q.get('state'))
    expect(createHash('sha256').update(saved.verifier).digest('base64url')).toBe(
      q.get('code_challenge'),
    )
  })

  it('rejects a cross-site POST (Origin check)', async () => {
    const res = await startFlow({ mode: 'link' }, undefined, 'https://evil.example')
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'forbidden', correlationId: expect.any(String) })
  })

  it('sends linking without a session to the login page', async () => {
    const res = await startFlow({ mode: 'link' })
    expect(res.headers.get('location')).toBe('/login?next=/account')
  })
})

describe('GET /api/auth/yandex/callback — rejections', () => {
  const started = async () => {
    const res = await startFlow({ mode: 'login' })
    return {
      state: new URL(res.headers.get('location')!).searchParams.get('state')!,
      cookie: `turdus_oauth=${cookieValue(res, 'turdus_oauth')!.value}`,
    }
  }

  it('forged state: refused before talking to Yandex, step cookie cleared', async () => {
    const { cookie } = await started()
    const res = await callbackReq('code=good-code&state=forged-state-value', cookie)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/login?yandex=state')
    expect(cookieValue(res, 'turdus_oauth')!.line).toMatch(/Max-Age=0/)
    expect(fakeYandex).not.toHaveBeenCalled()
  })

  it('no step cookie, or a tampered one (login CSRF): refused', async () => {
    const { state, cookie } = await started()
    expect((await callbackReq(`code=good-code&state=${state}`)).headers.get('location')).toBe(
      '/login?yandex=state',
    )
    const tampered = cookie.slice(0, -4) + (cookie.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    expect(
      (await callbackReq(`code=good-code&state=${state}`, tampered)).headers.get('location'),
    ).toBe('/login?yandex=state')
    // Чужая cookie (зашифрована другим ключом) тоже не подходит.
    const foreign = seal(Buffer.alloc(32, 7), { state, verifier: 'x', mode: 'login' }, 600)
    expect(
      (await callbackReq(`code=good-code&state=${state}`, `turdus_oauth=${foreign}`)).headers.get(
        'location',
      ),
    ).toBe('/login?yandex=state')
    expect(fakeYandex).not.toHaveBeenCalled()
  })

  it('foreign redirect URI (other host): refused', async () => {
    const { state, cookie } = await started()
    const res = await callbackReq(`code=good-code&state=${state}`, cookie, 'evil.example')
    expect(res.headers.get('location')).toBe('/login?yandex=redirect_mismatch')
    expect(fakeYandex).not.toHaveBeenCalled()
  })

  it('user denied on the Yandex screen', async () => {
    const { state, cookie } = await started()
    const res = await callbackReq(`error=access_denied&state=${state}`, cookie)
    expect(res.headers.get('location')).toBe('/login?yandex=denied')
    expect(fakeYandex).not.toHaveBeenCalled()
  })

  it('an expired step cookie is refused (10 minutes)', async () => {
    const config = yandexConfig(ENV)!
    const old = seal(
      config.cookieKey,
      { state: 's'.repeat(43), verifier: 'v'.repeat(43), mode: 'login', next: '/account' },
      600,
      Date.now() - 11 * 60_000,
    )
    const res = await callbackReq(`code=good-code&state=${'s'.repeat(43)}`, `turdus_oauth=${old}`)
    expect(res.headers.get('location')).toBe('/login?yandex=state')
  })

  it('exchanges the code server-side with client_secret and the PKCE verifier', async () => {
    const { state, cookie } = await started()
    await callbackReq(`code=good-code&state=${state}`, cookie)
    const token = calls.find((c) => c.url === 'https://oauth.yandex.ru/token')!
    const form = new URLSearchParams(String(token.init!.body))
    expect(form.get('client_secret')).toBe(ENV.YANDEX_CLIENT_SECRET)
    expect(form.get('code_verifier')).toMatch(/^[\w-]{43}$/)
    expect(form.get('grant_type')).toBe('authorization_code')
  })

  it('unverified email: no account is created or linked', async () => {
    info = yandexUser({ default_email: 'anna@yandex.ru', emails: [] })
    const { state, cookie } = await started()
    const res = await callbackReq(`code=good-code&state=${state}`, cookie)
    expect(res.headers.get('location')).toBe('/login?yandex=email_unverified')
    info = yandexUser({ default_email: undefined })
    const again = await started()
    expect(
      (await callbackReq(`code=good-code&state=${again.state}`, again.cookie)).headers.get(
        'location',
      ),
    ).toBe('/login?yandex=email_unverified')
    expect(holder.store!.dump().customers).toHaveLength(0)
  })

  it('a token issued to another app is not accepted', async () => {
    info = yandexUser({ client_id: 'someone-else' })
    const res = await signInWithYandex()
    expect(res.headers.get('location')).toBe('/login?yandex=failed')
    expect(holder.store!.dump().customers).toHaveLength(0)
  })

  it('Yandex refusing the code → failed, no session', async () => {
    const { state, cookie } = await started()
    const res = await callbackReq(`code=stolen-code&state=${state}`, cookie)
    expect(res.headers.get('location')).toBe('/login?yandex=failed')
    expect(cookieValue(res, 'turdus_session')).toBeNull()
  })
})

describe('sign-up and sign-in', () => {
  it('first login: consent step, then account; repeat login lands in the same account', async () => {
    const first = await signInWithYandex({ mode: 'register', next: '/afisha', ref: 'friend42' })
    expect(first.headers.get('location')).toBe('/register/yandex')
    expect(cookieValue(first, 'turdus_session')).toBeNull()
    expect(holder.store!.dump().customers).toHaveLength(0)
    const pending = cookieValue(first, 'turdus_oauth_signup')!
    expect(pending.line).toMatch(/HttpOnly/)
    // Почта в cookie зашифрована.
    expect(pending.value).not.toContain('anna')

    // Без согласия аккаунт не создаётся.
    const refused = await completeSignup(pending.value, false)
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ code: 'invalid' })
    expect(holder.store!.dump().customers).toHaveLength(0)
    expect((await completeSignup(pending.value, true, 'https://evil.example')).status).toBe(403)

    const done = await completeSignup(pending.value)
    expect(done.status).toBe(200)
    expect(await done.json()).toEqual({
      customer: { name: 'Анна Слепых', email: 'anna@yandex.ru' },
      next: '/afisha',
    })
    expect(cookieValue(done, 'turdus_session')!.line).toMatch(/HttpOnly/)
    expect(cookieValue(done, 'turdus_oauth_signup')!.line).toMatch(/Max-Age=0/)
    expect(holder.consents).toEqual(['anna@yandex.ru:register:yandex'])
    const [customer] = holder.store!.dump().customers
    // Приглашение друга — к только что созданному покупателю (T-062).
    expect(holder.attach).toHaveBeenCalledWith(customer!.id, 'FRIEND42', expect.any(Date))

    const again = await signInWithYandex({ next: '/afisha' })
    expect(again.headers.get('location')).toBe('/afisha')
    const session = cookieValue(again, 'turdus_session')!.value
    expect((await holder.auth!.getSession(session))!.customer.id).toBe(customer!.id)
    expect(holder.store!.dump().customers).toHaveLength(1)
    expect(holder.attach).toHaveBeenCalledTimes(1)
  })

  it('an existing customer with the same verified email is linked, not duplicated', async () => {
    const existing = await emailCustomer('anna@yandex.ru')
    const res = await signInWithYandex({ ref: 'FRIEND42' })
    expect(res.headers.get('location')).toBe('/account')
    const session = cookieValue(res, 'turdus_session')!.value
    expect((await holder.auth!.getSession(session))!.customer.id).toBe(existing.id)
    expect(await holder.auth!.linkedProviders(existing.id)).toEqual(['yandex'])
    // Уже существующий аккаунт по ссылке друга не привязывается.
    expect(holder.attach).not.toHaveBeenCalled()

    // Почта в Яндексе сменилась — вход по привязке, в тот же аккаунт.
    info = yandexUser({ default_email: 'anna.new@yandex.ru', emails: ['anna.new@yandex.ru'] })
    const later = await signInWithYandex()
    const s2 = cookieValue(later, 'turdus_session')!.value
    expect((await holder.auth!.getSession(s2))!.customer.id).toBe(existing.id)
    expect(holder.store!.dump().customers).toHaveLength(1)
  })

  it('next is relative-only', async () => {
    await emailCustomer('anna@yandex.ru')
    for (const next of ['//evil.example/x', 'https://evil.example', '/\\evil.example'])
      expect((await signInWithYandex({ next })).headers.get('location')).toBe('/account')
    expect(safeNext('/afisha?date=2026-11-01')).toBe('/afisha?date=2026-11-01')
  })

  it('an expired confirmation cannot create an account', async () => {
    const res = await completeSignup('garbage')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'expired' })
  })
})

describe('link and unlink in the profile', () => {
  it('links to the signed-in customer, refuses a Yandex ID owned by another, unlinks', async () => {
    const me = await emailCustomer('me@mail.ru')
    const res = await signInWithYandex({ mode: 'link' }, me.token)
    expect(res.headers.get('location')).toBe('/account?yandex=linked#profile')
    expect(await holder.auth!.linkedProviders(me.id)).toEqual(['yandex'])

    const other = await emailCustomer('other@mail.ru')
    const taken = await signInWithYandex({ mode: 'link' }, other.token)
    expect(taken.headers.get('location')).toBe('/account?yandex=taken#profile')
    expect(await holder.auth!.linkedProviders(other.id)).toEqual([])

    const del = (token?: string, origin = SITE) =>
      unlink(
        new NextRequest(`${SITE}/api/auth/yandex/link`, {
          method: 'DELETE',
          headers: { host: HOST, origin, ...(token && { cookie: `turdus_session=${token}` }) },
        }),
      )
    expect((await del(me.token, 'https://evil.example')).status).toBe(403)
    expect((await del()).status).toBe(401)
    // Пароля нет — отвязать всё равно можно: вход кодом на почту остаётся.
    const ok = await del(me.token)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('x-request-id')).toBeTruthy()
    expect(await holder.auth!.linkedProviders(me.id)).toEqual([])
  })

  it('a link started by one customer is not completed in another session', async () => {
    const me = await emailCustomer('me@mail.ru')
    const other = await emailCustomer('other@mail.ru')
    const started = await startFlow({ mode: 'link' }, `turdus_session=${me.token}`)
    const state = new URL(started.headers.get('location')!).searchParams.get('state')
    const oauth = cookieValue(started, 'turdus_oauth')!.value
    const res = await callbackReq(
      `code=good-code&state=${state}`,
      `turdus_oauth=${oauth}; turdus_session=${other.token}`,
    )
    expect(res.headers.get('location')).toBe('/login?next=/account&yandex=state')
    expect(await holder.auth!.linkedProviders(other.id)).toEqual([])
    expect(await holder.auth!.linkedProviders(me.id)).toEqual([])
  })
})

describe('profileFromInfo', () => {
  const config = { clientId: ENV.YANDEX_CLIENT_ID } as YandexConfig
  it('normalizes the email and picks a name', () => {
    expect(
      profileFromInfo(
        config,
        yandexUser({ default_email: 'Anna@Yandex.ru', real_name: '', display_name: 'anna' }),
      ),
    ).toEqual({
      ok: true,
      profile: { provider: 'yandex', subject: '1000123', email: 'anna@yandex.ru', name: 'anna' },
    })
  })
  it('rejects a missing id', () => {
    expect(profileFromInfo(config, yandexUser({ id: undefined }))).toEqual({
      ok: false,
      error: 'failed',
    })
  })
})

describe('yandex-view texts', () => {
  it('has a message for every callback outcome', () => {
    for (const code of [
      'unavailable',
      'too_many',
      'redirect_mismatch',
      'state',
      'denied',
      'email_unverified',
      'failed',
      'something-new',
    ])
      expect(yandexSignInNotice(code)?.text).toMatch(/\S/)
    expect(yandexSignInNotice(null)).toBeNull()
    expect(yandexLinkNotice('linked')).toMatchObject({ tone: 'info' })
    expect(yandexLinkNotice('taken')?.text).toMatch(/другому кабинету/)
    expect(yandexCompleteError(400, 'expired')).toMatch(/заново/)
    expect(yandexCompleteError(400, 'invalid')).toMatch(/согласие/)
  })
})
