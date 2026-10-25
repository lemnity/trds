import { describe, expect, it } from 'vitest'

import {
  codeFieldError,
  newPasswordError,
  passwordChangeFeedback,
  passwordCodeFeedback,
} from '../../src/components/account/security-view'
import {
  createAuthService,
  memoryAuthStore,
  type SentCode,
} from '../../src/modules/accounts/service'

const SECRET = 'test-secret-test-secret-test-secret-123'

const setup = () => {
  let now = new Date('2026-10-25T10:00:00Z').getTime()
  const sent: SentCode[] = []
  const store = memoryAuthStore()
  let nextCode = '123456'
  const auth = createAuthService({
    store,
    secret: SECRET,
    now: () => new Date(now),
    sendCode: async (message) => {
      sent.push(message)
    },
    randomCode: () => nextCode,
  })
  /** Регистрация (по желанию — с паролем) и вход: покупатель и токен сессии. */
  const signUp = async (password?: string) => {
    await auth.requestCode({
      email: 'a@t.ru',
      purpose: 'register',
      name: 'Степан',
      ...(password && { password }),
    })
    const r = await auth.verifyCode({ email: 'a@t.ru', code: nextCode })
    if (!r.ok) throw new Error('sign-up failed')
    now += 61_000
    return { customerId: r.customer.id, token: r.session.token, created: r.created }
  }
  const login = async () => {
    await auth.requestCode({ email: 'a@t.ru', purpose: 'login' })
    const r = await auth.verifyCode({ email: 'a@t.ru', code: nextCode })
    if (!r.ok) throw new Error('login failed')
    now += 61_000
    return r
  }
  return {
    auth,
    store,
    sent,
    signUp,
    login,
    tick: (ms: number) => (now += ms),
    setCode: (c: string) => (nextCode = c),
  }
}

describe('set and change the password in the profile', () => {
  it('sets a first password with just the session', async () => {
    const { auth, signUp } = setup()
    const { customerId, token } = await signUp()
    expect(await auth.hasPassword(customerId)).toBe(false)
    expect(
      await auth.changePassword({ customerId, next: 'new-secret-1', keepToken: token }),
    ).toEqual({ ok: true })
    expect(await auth.hasPassword(customerId)).toBe(true)
    expect((await auth.passwordLogin({ email: 'a@t.ru', password: 'new-secret-1' })).ok).toBe(true)
  })

  it('stores the same scrypt format as registration', async () => {
    const { auth, store, signUp } = setup()
    const { customerId } = await signUp()
    await auth.changePassword({ customerId, next: 'new-secret-1' })
    expect(store.dump().customers[0]!.passwordHash).toMatch(
      /^scrypt\$16384\$8\$1\$[\w-]{22}\$[\w-]{43}$/,
    )
  })

  it('needs the current password or an email code to change an existing one', async () => {
    const { auth, signUp } = setup()
    const { customerId } = await signUp('old-secret-1')
    expect(await auth.changePassword({ customerId, next: 'new-secret-1' })).toEqual({
      ok: false,
      error: 'proof_required',
    })
    expect(
      await auth.changePassword({ customerId, next: 'new-secret-1', current: 'wrong-pass' }),
    ).toEqual({ ok: false, error: 'invalid_current' })
    expect(
      await auth.changePassword({ customerId, next: 'new-secret-1', current: 'old-secret-1' }),
    ).toEqual({ ok: true })
    expect((await auth.passwordLogin({ email: 'a@t.ru', password: 'old-secret-1' })).ok).toBe(false)
    expect((await auth.passwordLogin({ email: 'a@t.ru', password: 'new-secret-1' })).ok).toBe(true)
  })

  it('changes the password with a fresh one-time email code', async () => {
    const { auth, sent, signUp, setCode } = setup()
    const { customerId } = await signUp('old-secret-1')
    setCode('654321')
    expect(await auth.requestPasswordCode(customerId)).toEqual({ ok: true })
    expect(sent.at(-1)).toEqual({ email: 'a@t.ru', code: '654321', purpose: 'password' })
    expect(await auth.changePassword({ customerId, next: 'new-secret-1', code: '000000' })).toEqual(
      { ok: false, error: 'invalid_code' },
    )
    expect(await auth.changePassword({ customerId, next: 'new-secret-1', code: '654321' })).toEqual(
      { ok: true },
    )
    // Код одноразовый.
    expect(await auth.changePassword({ customerId, next: 'new-secret-2', code: '654321' })).toEqual(
      { ok: false, error: 'invalid_code' },
    )
  })

  it('does not accept a login code for a password change, nor a password code for login', async () => {
    const { auth, signUp, setCode } = setup()
    const { customerId } = await signUp('old-secret-1')
    setCode('111111')
    await auth.requestCode({ email: 'a@t.ru', purpose: 'login' })
    expect(await auth.changePassword({ customerId, next: 'new-secret-1', code: '111111' })).toEqual(
      { ok: false, error: 'invalid_code' },
    )

    const other = setup()
    const signed = await other.signUp('old-secret-1')
    other.setCode('222222')
    await other.auth.requestPasswordCode(signed.customerId)
    expect(await other.auth.verifyCode({ email: 'a@t.ru', code: '222222' })).toEqual({
      ok: false,
      error: 'invalid',
    })
  })

  it('rejects a too short or too long new password', async () => {
    const { auth, signUp } = setup()
    const { customerId } = await signUp()
    for (const next of ['short', 'x'.repeat(129)])
      expect(await auth.changePassword({ customerId, next })).toEqual({ ok: false, error: 'weak' })
  })

  it('signs other devices out after a change, keeps this one', async () => {
    const { auth, signUp, login } = setup()
    const { customerId, token } = await signUp('old-secret-1')
    const phone = await login()
    await auth.changePassword({
      customerId,
      next: 'new-secret-1',
      current: 'old-secret-1',
      keepToken: token,
    })
    expect(await auth.getSession(token)).not.toBeNull()
    expect(await auth.getSession(phone.ok ? phone.session.token : '')).toBeNull()
  })
})

describe('sign out everywhere', () => {
  it('revokes every session of the customer, including this one, and nobody else’s', async () => {
    const { auth, signUp, login } = setup()
    const { customerId, token } = await signUp()
    const phone = await login()
    const stranger = setup()
    const theirs = await stranger.signUp()
    await auth.logoutEverywhere(customerId)
    expect(await auth.getSession(token)).toBeNull()
    expect(await auth.getSession(phone.ok ? phone.session.token : '')).toBeNull()
    expect(await stranger.auth.getSession(theirs.token)).not.toBeNull()
  })
})

describe('verifyCode marks new customers (for the invite link)', () => {
  it('is created on first confirmation only', async () => {
    const { signUp, login } = setup()
    expect((await signUp()).created).toBe(true)
    const again = await login()
    expect(again.ok && again.created).toBe(false)
  })
})

describe('profile security texts', () => {
  it('puts each API error next to the right field', () => {
    expect(passwordChangeFeedback(400, 'invalid_current')).toMatchObject({ field: 'current' })
    expect(passwordChangeFeedback(400, 'invalid_code')).toMatchObject({ field: 'code' })
    expect(passwordChangeFeedback(400, 'weak')).toMatchObject({ field: 'next' })
    expect(passwordChangeFeedback(401)).toMatchObject({ kind: 'notice', relogin: true })
    expect(passwordChangeFeedback(429).kind).toBe('notice')
    expect(passwordChangeFeedback(0).kind).toBe('notice')
  })

  it('explains code sending limits', () => {
    expect(passwordCodeFeedback(429, { error: 'cooldown', retryAfter: 42 })).toContain('42 с')
    expect(passwordCodeFeedback(429, { error: 'too_many', retryAfter: 1800 })).toContain('30 мин')
    expect(passwordCodeFeedback(503, { error: 'email_unavailable' })).toContain('не настроена')
  })

  it('validates inputs before sending', () => {
    expect(newPasswordError('short')).toBe('Не короче 8 символов')
    expect(newPasswordError('long-enough')).toBeNull()
    expect(codeFieldError('123')).toBe('Введите 6 цифр из письма')
    expect(codeFieldError('123456')).toBeNull()
  })
})
