import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { hasRole, mfaVerified, type StaffUser } from '../../src/payload/access/roles'
import type { CmsAuditEntry } from '../../src/payload/audit'
import { mfaEndpoints } from '../../src/payload/auth/endpoints'
import {
  MFA_COOKIE,
  MFA_LOCK_MS,
  MFA_MAX_ATTEMPTS,
  RECOVERY_CODES_COUNT,
  createMfaService,
  decryptSecret,
  deriveMfaKeys,
  memoryMfaStore,
  signMfaCookie,
  verifyMfaCookie,
  type MfaService,
  type MfaStore,
} from '../../src/payload/auth/mfa'
import {
  TOTP_PERIOD_SECONDS,
  base32Decode,
  base32Encode,
  hotp,
  matchTotp,
  otpauthUrl,
  totpAt,
} from '../../src/payload/auth/totp'

// T-023, rules.md §4: MFA обязательна администраторам; recovery flow тестируется отдельно.
const SECRET = 'mfa-test-payload-secret-0123456789abcdef'
const keys = deriveMfaKeys(SECRET)
// Начало шага TOTP «сейчас»: отметка MFA сверяется с реальными часами.
const T0 = new Date(Math.floor(Date.now() / 30_000) * 30_000)
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000)

beforeAll(() => {
  vi.stubEnv('PAYLOAD_SECRET', SECRET)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  // RFC 6238, приложение B: секрет «12345678901234567890», SHA-1, 8 цифр.
  const rfcSecret = Buffer.from('12345678901234567890')
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('matches the RFC test vector at T=%i', (t, code) => {
    expect(hotp(rfcSecret, Math.floor(t / TOTP_PERIOD_SECONDS), 8)).toBe(code)
  })

  it('round-trips base32 (RFC 4648)', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI')
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar')
    expect(base32Decode(base32Encode(rfcSecret)).equals(rfcSecret)).toBe(true)
  })

  it('accepts a code within ±1 step only', () => {
    const secret = base32Encode(rfcSecret)
    const code = totpAt(secret, T0)
    expect(matchTotp(secret, code, T0)).not.toBeNull()
    expect(matchTotp(secret, code, later(30))).not.toBeNull()
    expect(matchTotp(secret, code, later(90))).toBeNull()
    expect(matchTotp(secret, '12345', T0)).toBeNull()
    expect(matchTotp(secret, 'abcdef', T0)).toBeNull()
  })

  it('builds an otpauth:// link for authenticator apps', () => {
    const url = new URL(otpauthUrl({ issuer: 'TURDUS CMS', account: 'a@b.ru', secret: 'ABC' }))
    expect(url.protocol).toBe('otpauth:')
    expect(url.searchParams.get('secret')).toBe('ABC')
    expect(url.searchParams.get('digits')).toBe('6')
  })
})

describe('MFA service', () => {
  let store: MfaStore
  let mfa: MfaService

  const enroll = async (userId = '1', at = T0) => {
    const setup = await mfa.beginSetup(userId, 'admin@example.com')
    if (!setup.ok) throw new Error(setup.error)
    const confirmed = await mfa.confirmSetup(userId, totpAt(setup.secret, at), at)
    if (!confirmed.ok) throw new Error(confirmed.error)
    return { secret: setup.secret, recoveryCodes: confirmed.recoveryCodes }
  }

  beforeEach(() => {
    store = memoryMfaStore()
    mfa = createMfaService({ store, keys })
  })

  it('sets up TOTP: secret shown once, stored only encrypted, recovery codes issued', async () => {
    const { secret, recoveryCodes } = await enroll()
    const record = await store.get('1')
    expect(record?.secret).not.toContain(secret)
    expect(decryptSecret(record!.secret!, keys.enc)).toBe(secret)
    expect(recoveryCodes).toHaveLength(RECOVERY_CODES_COUNT)
    expect(new Set(recoveryCodes).size).toBe(RECOVERY_CODES_COUNT)
    expect(await mfa.status('1', T0)).toEqual({
      enrolled: true,
      locked: false,
      recoveryCodesLeft: RECOVERY_CODES_COUNT,
    })
    expect(await mfa.beginSetup('1', 'x')).toEqual({ ok: false, error: 'ALREADY_ENROLLED' })
  })

  it('does not enable MFA with a wrong first code', async () => {
    const setup = await mfa.beginSetup('1', 'a')
    expect(await mfa.confirmSetup('1', '000000', T0)).toEqual({
      ok: false,
      error: 'INVALID_CODE',
    })
    expect((await mfa.status('1', T0)).enrolled).toBe(false)
    expect(setup.ok).toBe(true)
  })

  it('verifies a valid code and rejects a wrong one', async () => {
    const { secret } = await enroll()
    const at = later(60)
    expect(await mfa.verify('1', { code: totpAt(secret, at) }, at)).toMatchObject({
      ok: true,
      method: 'totp',
    })
    expect(await mfa.verify('1', { code: '123456' }, later(120))).toEqual({
      ok: false,
      error: 'INVALID_CODE',
    })
  })

  it('rejects a replay of the same code within its window', async () => {
    const { secret } = await enroll()
    const at = later(60)
    const code = totpAt(secret, at)
    expect((await mfa.verify('1', { code }, at)).ok).toBe(true)
    // Тот же код ещё в окне ±30 с — повтор не принимается.
    expect(await mfa.verify('1', { code }, later(70))).toEqual({
      ok: false,
      error: 'INVALID_CODE',
    })
    // Код следующего шага — принимается.
    expect((await mfa.verify('1', { code: totpAt(secret, later(90)) }, later(90))).ok).toBe(true)
  })

  it('rejects the setup code being reused for login', async () => {
    const setup = await mfa.beginSetup('1', 'a')
    if (!setup.ok) throw new Error()
    const code = totpAt(setup.secret, T0)
    expect((await mfa.confirmSetup('1', code, T0)).ok).toBe(true)
    expect((await mfa.verify('1', { code }, later(5))).ok).toBe(false)
  })

  it(`locks for 15 minutes after ${MFA_MAX_ATTEMPTS} wrong codes`, async () => {
    const { secret } = await enroll()
    for (let i = 0; i < MFA_MAX_ATTEMPTS; i++)
      expect((await mfa.verify('1', { code: '000000' }, later(60))).ok).toBe(false)
    const at = later(61)
    expect(await mfa.verify('1', { code: totpAt(secret, at) }, at)).toEqual({
      ok: false,
      error: 'LOCKED',
    })
    const after = new Date(at.getTime() + MFA_LOCK_MS + 1000)
    expect((await mfa.verify('1', { code: totpAt(secret, after) }, after)).ok).toBe(true)
  })

  it('accepts each recovery code exactly once', async () => {
    const { recoveryCodes } = await enroll()
    const [first, second] = recoveryCodes
    expect(await mfa.verify('1', { recoveryCode: first! }, later(60))).toEqual({
      ok: true,
      method: 'recovery',
      recoveryCodesLeft: RECOVERY_CODES_COUNT - 1,
    })
    expect(await mfa.verify('1', { recoveryCode: first! }, later(61))).toEqual({
      ok: false,
      error: 'INVALID_CODE',
    })
    // Регистр и дефис не важны: код можно ввести с бумажки как угодно.
    const typed = second!.toUpperCase().replace('-', '')
    expect((await mfa.verify('1', { recoveryCode: typed }, later(62))).ok).toBe(true)
  })

  it('regenerating recovery codes invalidates the old set', async () => {
    const { recoveryCodes } = await enroll()
    const fresh = await mfa.regenerateRecoveryCodes('1')
    expect((await mfa.verify('1', { recoveryCode: recoveryCodes[0]! }, later(60))).ok).toBe(false)
    expect((await mfa.verify('1', { recoveryCode: fresh[0]! }, later(61))).ok).toBe(true)
  })

  it('recovery flow: lost phone → recovery code → reset → enrol a new phone', async () => {
    const { recoveryCodes, secret: oldSecret } = await enroll()
    expect((await mfa.verify('1', { recoveryCode: recoveryCodes[3]! }, later(60))).ok).toBe(true)
    await mfa.reset('1')
    expect(await mfa.verify('1', { code: totpAt(oldSecret, later(90)) }, later(90))).toEqual({
      ok: false,
      error: 'NOT_ENROLLED',
    })
    const { secret } = await enroll('1', later(120))
    expect(secret).not.toBe(oldSecret)
    expect((await mfa.verify('1', { code: totpAt(oldSecret, later(150)) }, later(150))).ok).toBe(
      false,
    )
  })
})

describe('MFA session cookie', () => {
  const claims = { userId: '7', sid: 'sid-1', expiresAt: later(3600) }

  it('is bound to the user, the Payload session and an expiry', () => {
    const cookie = signMfaCookie(claims, keys.cookie)
    expect(verifyMfaCookie(cookie, keys.cookie, { userId: '7', sid: 'sid-1', now: T0 })).toBe(true)
    expect(verifyMfaCookie(cookie, keys.cookie, { userId: '8', sid: 'sid-1', now: T0 })).toBe(false)
    expect(verifyMfaCookie(cookie, keys.cookie, { userId: '7', sid: 'sid-2', now: T0 })).toBe(false)
    expect(
      verifyMfaCookie(cookie, keys.cookie, { userId: '7', sid: 'sid-1', now: later(3601) }),
    ).toBe(false)
  })

  it('rejects a tampered or foreign-key cookie', () => {
    const cookie = signMfaCookie(claims, keys.cookie)
    const [body, mac] = cookie.split('.')
    const forged = Buffer.from(JSON.stringify({ u: '1', s: 'sid-1', e: 9e9 })).toString('base64url')
    expect(verifyMfaCookie(`${forged}.${mac}`, keys.cookie, { userId: '1', sid: 'sid-1' })).toBe(
      false,
    )
    const other = deriveMfaKeys('another-payload-secret-0123456789abcdef')
    expect(verifyMfaCookie(`${body}.${mac}`, other.cookie, { userId: '7', sid: 'sid-1' })).toBe(
      false,
    )
  })
})

describe('MFA endpoints and the access gate', () => {
  const admin: StaffUser = {
    id: 1,
    email: 'admin@example.com',
    role: 'admin',
    collection: 'admin-users',
    _sid: 'sess-1',
  }
  let mfa: MfaService
  let audit: CmsAuditEntry[]
  let flags: Record<string, boolean>
  let now: Date
  let endpoints: ReturnType<typeof mfaEndpoints>

  const req = (
    user: StaffUser | null,
    {
      body,
      cookie,
      origin = 'https://turdus.test',
    }: { body?: unknown; cookie?: string; origin?: string } = {},
  ) =>
    ({
      user,
      headers: new Headers({
        host: 'turdus.test',
        ...(origin && { origin }),
        ...(cookie && { cookie: `${MFA_COOKIE}=${cookie}` }),
      }),
      json: async () => body,
    }) as unknown as PayloadRequest

  const call = async (path: string, r: PayloadRequest) => {
    const endpoint = endpoints.find((e) => e.path === path)!
    const res = await endpoint.handler(r)
    const setCookie = res.headers.get('set-cookie') ?? ''
    const cookie = setCookie.match(new RegExp(`${MFA_COOKIE}=([^;]*)`))?.[1]
    return { status: res.status, body: (await res.json()) as Record<string, unknown>, cookie }
  }

  beforeEach(() => {
    mfa = createMfaService({ store: memoryMfaStore(), keys })
    audit = []
    flags = {}
    now = T0
    endpoints = mfaEndpoints({
      service: () => mfa,
      audit: async (_req, entry) => {
        audit.push(entry)
      },
      setMfaFlag: async (_req, id, enabled) => {
        flags[String(id)] = enabled
      },
      now: () => now,
    })
  })

  it('an admin with only a password has no rights until the second factor', async () => {
    const r = req(admin)
    expect(hasRole(r, ['admin'])).toBe(false)
    const status = await call('/mfa/status', r)
    expect(status.body).toMatchObject({ required: true, verified: false, enrolled: false })
  })

  it('setup → confirm sets the session mark; the admin gets rights for this session only', async () => {
    const setup = await call('/mfa/setup', req(admin))
    expect(setup.status).toBe(200)
    const code = totpAt(String(setup.body.secret), now)
    const confirmed = await call('/mfa/setup/confirm', req(admin, { body: { code } }))
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.recoveryCodes).toHaveLength(RECOVERY_CODES_COUNT)
    expect(flags['1']).toBe(true)
    expect(audit.map((a) => a.action)).toEqual(['cms.mfa.enable'])
    // Права появляются только с cookie этой сессии; в другой сессии — снова нет.
    const withMark = req(admin, { cookie: confirmed.cookie })
    expect(mfaVerified(withMark, admin)).toBe(true)
    expect(hasRole(withMark, ['admin'])).toBe(true)
    const otherSession = req({ ...admin, _sid: 'sess-2' }, { cookie: confirmed.cookie })
    expect(hasRole(otherSession, ['admin'])).toBe(false)
  })

  it('verify: wrong code is refused and audited, a correct one grants the mark', async () => {
    const setup = await call('/mfa/setup', req(admin))
    const secret = String(setup.body.secret)
    await call('/mfa/setup/confirm', req(admin, { body: { code: totpAt(secret, now) } }))
    now = later(60)
    const wrong = await call('/mfa/verify', req(admin, { body: { code: '000000' } }))
    expect(wrong.status).toBe(400)
    expect(wrong.cookie).toBeUndefined()
    expect(audit.at(-1)).toMatchObject({ action: 'cms.mfa.verify', result: 'denied' })
    const ok = await call('/mfa/verify', req(admin, { body: { code: totpAt(secret, now) } }))
    expect(ok.status).toBe(200)
    expect(hasRole(req(admin, { cookie: ok.cookie }), ['admin'])).toBe(true)
  })

  it('refuses cross-origin POST (CSRF) and anonymous calls', async () => {
    expect((await call('/mfa/setup', req(admin, { origin: 'https://evil.test' }))).status).toBe(403)
    expect((await call('/mfa/verify', req(null))).status).toBe(401)
  })

  it('recovery flow over HTTP: recovery code → reset own MFA → set up again', async () => {
    const setup = await call('/mfa/setup', req(admin))
    const confirmed = await call(
      '/mfa/setup/confirm',
      req(admin, { body: { code: totpAt(String(setup.body.secret), now) } }),
    )
    const [code] = confirmed.body.recoveryCodes as string[]
    // Новая сессия (телефон утерян): входим кодом восстановления.
    const session = { ...admin, _sid: 'sess-9' }
    now = later(300)
    const recovered = await call('/mfa/verify', req(session, { body: { recoveryCode: code } }))
    expect(recovered.body).toMatchObject({ method: 'recovery', recoveryCodesLeft: 9 })
    expect(audit.at(-1)).toMatchObject({ action: 'cms.mfa.recovery_code_used' })
    // Повтор того же кода — отказ.
    expect((await call('/mfa/verify', req(session, { body: { recoveryCode: code } }))).status).toBe(
      400,
    )
    // Без второго фактора сбросить свою MFA нельзя; с ним — можно.
    expect((await call('/mfa/reset', req(session))).status).toBe(403)
    const reset = await call('/mfa/reset', req(session, { cookie: recovered.cookie }))
    expect(reset.status).toBe(200)
    expect(flags['1']).toBe(false)
    expect((await call('/mfa/status', req(session))).body).toMatchObject({ enrolled: false })
    expect((await call('/mfa/setup', req(session))).status).toBe(200)
  })

  it("only a system admin resets someone else's MFA, and only with a reason", async () => {
    const setup = await call('/mfa/setup', req(admin))
    const confirmed = await call(
      '/mfa/setup/confirm',
      req(admin, { body: { code: totpAt(String(setup.body.secret), now) } }),
    )
    const asAdmin = req(admin, { cookie: confirmed.cookie, body: { userId: 5, reason: 'x' } })
    expect((await call('/mfa/reset', asAdmin)).status).toBe(403)

    const root: StaffUser = { ...admin, id: 2, systemAdmin: true, _sid: 'root' }
    await mfa.beginSetup('2', 'root').then(async (s) => {
      if (s.ok) await mfa.confirmSetup('2', totpAt(s.secret, now), now)
    })
    const rootCookie = signMfaCookie(
      { userId: '2', sid: 'root', expiresAt: later(3600) },
      keys.cookie,
    )
    const noReason = req(root, { cookie: rootCookie, body: { userId: 5 } })
    expect((await call('/mfa/reset', noReason)).status).toBe(400)
    const withReason = req(root, {
      cookie: rootCookie,
      body: { userId: 5, reason: 'телефон утерян, заявка №12' },
    })
    expect((await call('/mfa/reset', withReason)).status).toBe(200)
    expect(audit.at(-1)).toMatchObject({ action: 'cms.mfa.reset', entityId: '5', result: 'ok' })
  })
})
