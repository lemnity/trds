import { describe, expect, it } from 'vitest'

import {
  createAuthService,
  memoryAuthStore,
  OTP_RULES,
  type SentCode,
} from '../../src/modules/accounts/service'

const SECRET = 'test-secret-test-secret-test-secret-123'

const setup = () => {
  let now = new Date('2026-10-21T10:00:00Z').getTime()
  const sent: SentCode[] = []
  const store = memoryAuthStore()
  const auth = createAuthService({
    store,
    secret: SECRET,
    now: () => new Date(now),
    sendCode: async (message) => {
      sent.push(message)
    },
    randomCode: () => '123456',
  })
  return { auth, store, sent, tick: (ms: number) => (now += ms) }
}

describe('requestCode', () => {
  it('sends a code and stores only its hash', async () => {
    const { auth, store, sent } = setup()
    const r = await auth.requestCode({ email: 'Stepan@Theatre.ru', purpose: 'login' })
    expect(r).toEqual({ ok: true })
    expect(sent).toEqual([{ email: 'stepan@theatre.ru', code: '123456', purpose: 'login' }])
    const rows = store.dump().codes
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain('123456')
  })

  it('answers the same for unknown and known emails (no account enumeration)', async () => {
    const { auth } = setup()
    const unknown = await auth.requestCode({ email: 'nobody@t.ru', purpose: 'login' })
    await auth.verifyCode({ email: 'a@t.ru', code: '123456' }).catch(() => null)
    const known = await auth.requestCode({ email: 'a@t.ru', purpose: 'login' })
    expect(unknown).toEqual(known)
  })

  it('does not resend within the cooldown', async () => {
    const { auth, sent, tick } = setup()
    await auth.requestCode({ email: 'a@t.ru', purpose: 'login' })
    tick(10_000)
    expect(await auth.requestCode({ email: 'a@t.ru', purpose: 'login' })).toEqual({
      ok: false,
      error: 'cooldown',
      retryAfter: OTP_RULES.resendAfterSec - 10,
    })
    expect(sent).toHaveLength(1)
  })

  it('limits sends per email per hour', async () => {
    const { auth, tick } = setup()
    for (let i = 0; i < OTP_RULES.maxSendsPerHour; i++) {
      expect((await auth.requestCode({ email: 'a@t.ru', purpose: 'login' })).ok).toBe(true)
      tick(OTP_RULES.resendAfterSec * 1000)
    }
    expect(await auth.requestCode({ email: 'a@t.ru', purpose: 'login' })).toMatchObject({
      ok: false,
      error: 'too_many',
    })
  })
})

describe('verifyCode', () => {
  it('creates a customer and a session for a correct code', async () => {
    const { auth, store } = setup()
    await auth.requestCode({ email: 'a@t.ru', purpose: 'register', name: 'Степан' })
    const r = await auth.verifyCode({ email: 'a@t.ru', code: '123456' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.session.token).toMatch(/^[\w-]{43}$/)
    expect(r.customer).toMatchObject({ email: 'a@t.ru', name: 'Степан' })
    expect(JSON.stringify(store.dump().sessions)).not.toContain(r.session.token)
  })

  it('rejects a reused code', async () => {
    const { auth } = setup()
    await auth.requestCode({ email: 'a@t.ru', purpose: 'login' })
    expect((await auth.verifyCode({ email: 'a@t.ru', code: '123456' })).ok).toBe(true)
    expect(await auth.verifyCode({ email: 'a@t.ru', code: '123456' })).toEqual({
      ok: false,
      error: 'invalid',
    })
  })

  it('rejects an expired code', async () => {
    const { auth, tick } = setup()
    await auth.requestCode({ email: 'a@t.ru', purpose: 'login' })
    tick(OTP_RULES.ttlSec * 1000 + 1)
    expect(await auth.verifyCode({ email: 'a@t.ru', code: '123456' })).toEqual({
      ok: false,
      error: 'invalid',
    })
  })

  it('burns the code after too many wrong attempts', async () => {
    const { auth } = setup()
    await auth.requestCode({ email: 'a@t.ru', purpose: 'login' })
    for (let i = 0; i < OTP_RULES.maxAttempts; i++)
      expect(await auth.verifyCode({ email: 'a@t.ru', code: '000000' })).toEqual({
        ok: false,
        error: 'invalid',
      })
    expect(await auth.verifyCode({ email: 'a@t.ru', code: '123456' })).toEqual({
      ok: false,
      error: 'invalid',
    })
  })

  it('logs into the same customer on the next login and keeps the name', async () => {
    const { auth, tick } = setup()
    await auth.requestCode({ email: 'a@t.ru', purpose: 'register', name: 'Степан' })
    const first = await auth.verifyCode({ email: 'a@t.ru', code: '123456' })
    tick(OTP_RULES.resendAfterSec * 1000)
    await auth.requestCode({ email: 'A@t.ru', purpose: 'login' })
    const second = await auth.verifyCode({ email: 'a@t.ru', code: '123456' })
    expect(first.ok && second.ok && first.customer.id === second.customer.id).toBe(true)
    expect(second.ok && second.customer.name).toBe('Степан')
  })
})

describe('sessions', () => {
  it('resolves, then revokes on logout', async () => {
    const { auth } = setup()
    await auth.requestCode({ email: 'a@t.ru', purpose: 'login' })
    const r = await auth.verifyCode({ email: 'a@t.ru', code: '123456' })
    if (!r.ok) throw new Error('login failed')
    expect(await auth.getSession(r.session.token)).toMatchObject({ customer: { email: 'a@t.ru' } })
    await auth.logout(r.session.token)
    expect(await auth.getSession(r.session.token)).toBeNull()
  })

  it('expires', async () => {
    const { auth, tick } = setup()
    await auth.requestCode({ email: 'a@t.ru', purpose: 'login' })
    const r = await auth.verifyCode({ email: 'a@t.ru', code: '123456' })
    if (!r.ok) throw new Error('login failed')
    tick(OTP_RULES.sessionDays * 86_400_000 + 1)
    expect(await auth.getSession(r.session.token)).toBeNull()
  })

  it('ignores garbage tokens', async () => {
    const { auth } = setup()
    expect(await auth.getSession('nope')).toBeNull()
    expect(await auth.getSession('')).toBeNull()
  })
})

describe('password', () => {
  const register = async (auth: ReturnType<typeof setup>['auth'], password = 'теат р 12') => {
    await auth.requestCode({ email: 'a@t.ru', purpose: 'register', name: 'Степан', password })
    return auth.verifyCode({ email: 'a@t.ru', code: '123456' })
  }

  it('stores only a salted hash, set on email confirmation', async () => {
    const { auth, store } = setup()
    await register(auth)
    const dump = JSON.stringify(store.dump())
    expect(dump).not.toContain('теат р 12')
    expect(store.dump().customers[0]?.passwordHash).toMatch(/^scrypt\$/)
  })

  it('logs in with the right password and opens a session', async () => {
    const { auth } = setup()
    await register(auth)
    const r = await auth.passwordLogin({ email: 'A@t.ru', password: 'теат р 12' })
    expect(r.ok && r.customer.email).toBe('a@t.ru')
    expect(r.ok && (await auth.getSession(r.session.token))?.customer.name).toBe('Степан')
  })

  it('answers the same for a wrong password, an unknown email and a passwordless account', async () => {
    const { auth, tick } = setup()
    await register(auth)
    expect(await auth.passwordLogin({ email: 'a@t.ru', password: 'wrong-pass' })).toEqual({
      ok: false,
      error: 'invalid',
    })
    expect(await auth.passwordLogin({ email: 'nobody@t.ru', password: 'whatever1' })).toEqual({
      ok: false,
      error: 'invalid',
    })
    tick(OTP_RULES.resendAfterSec * 1000)
    await auth.requestCode({ email: 'b@t.ru', purpose: 'login' })
    await auth.verifyCode({ email: 'b@t.ru', code: '123456' })
    expect(await auth.passwordLogin({ email: 'b@t.ru', password: 'whatever1' })).toEqual({
      ok: false,
      error: 'invalid',
    })
  })

  it('does not overwrite an existing password through a second registration', async () => {
    const { auth, tick } = setup()
    await register(auth, 'first-pass-1')
    tick(OTP_RULES.resendAfterSec * 1000)
    await register(auth, 'second-pass-2')
    expect((await auth.passwordLogin({ email: 'a@t.ru', password: 'first-pass-1' })).ok).toBe(true)
    expect((await auth.passwordLogin({ email: 'a@t.ru', password: 'second-pass-2' })).ok).toBe(
      false,
    )
  })
})
