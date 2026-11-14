import type { Endpoint, PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'

import { createAuthService, memoryAuthStore } from '../../src/modules/accounts/service'
import type { CmsAuditEntry } from '../../src/payload/audit'
import {
  blockPasswordLogin,
  codeLoginEndpoints,
  PASSWORD_LOGIN_DISABLED,
  type StaffDoc,
} from '../../src/payload/auth/codeLogin'
import {
  createSuperAdminVerifier,
  parseSuperAdminConfig,
  type SuperAdminConfig,
} from '../../src/payload/auth/superAdmin'
import { generateTotpSecret, totpAt } from '../../src/payload/auth/totp'

// Вход в админку без пароля: почта → код из письма → (затем) код из приложения. Здесь — первый
// шаг: код уходит только сотруднику, ответ не выдаёт, есть ли такая почта, верный код начинает
// сессию Payload, неверный — нет, и всё это в журнале.
const KASSA: StaffDoc = { id: 7, email: 'kassa@turdus.ru' } as StaffDoc

const SUPER: SuperAdminConfig = { email: 'owner@turdus.ru', secret: generateTotpSecret() }
const OWNER: StaffDoc = { id: 1, email: SUPER.email } as StaffDoc

const setup = ({ superAdmin = null as SuperAdminConfig | null, failLimit = 5 } = {}) => {
  const sent: string[] = []
  const auth = createAuthService({
    store: memoryAuthStore(),
    secret: 'code-login-test-secret-0123456789abcdef',
    sendCode: async ({ email, code }) => {
      sent.push(`${email}:${code}`)
    },
    randomCode: () => '424242',
  })
  const audit: CmsAuditEntry[] = []
  const sessions: StaffDoc[] = []
  const endpoints = codeLoginEndpoints({
    accounts: async () => auth,
    findStaff: async (_req, email) => (email === KASSA.email ? KASSA : null),
    issueSession: async (_req, user) => {
      sessions.push(user)
      return { cookie: 'payload-token=jwt; Path=/; HttpOnly', sid: 'sid-1' }
    },
    superAdmin: () => superAdmin,
    verifySuperAdminCode: createSuperAdminVerifier(),
    ensureSuperAdmin: async () => OWNER,
    mfaCookie: (userId, sid) => `trds-cms-mfa=${userId}.${sid}; Path=/; HttpOnly`,
    superAdminFailures: (() => {
      let fails = 0
      return {
        hit: async () => ++fails <= failLimit,
        allowed: async () => fails < failLimit,
      }
    })(),
    audit: async (_req, entry) => {
      audit.push(entry)
    },
    requestsByIp: { hit: async () => true, allowed: async () => true },
    loginsByIp: { hit: async () => true, allowed: async () => true },
  })
  return { endpoints, sent, audit, sessions }
}

const reqOf = (body: unknown, origin: string | null = 'https://cms.test') => {
  const headers = new Headers({ host: 'cms.test' })
  if (origin) headers.set('origin', origin)
  return { headers, json: async () => body } as unknown as PayloadRequest
}

const call = async (endpoints: Endpoint[], path: string, req: PayloadRequest) => {
  const ep = endpoints.find((e) => e.method === 'post' && e.path === path)!
  const res = await ep.handler(req)
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, res }
}

describe('POST /cms/auth/code', () => {
  it('сотруднику отправляет код; почта приводится к нижнему регистру', async () => {
    const { endpoints, sent } = setup()
    const r = await call(endpoints, '/cms/auth/code', reqOf({ email: ' Kassa@Turdus.ru ' }))
    expect(r).toMatchObject({ status: 200, body: { ok: true } })
    expect(sent).toEqual(['kassa@turdus.ru:424242'])
  })

  it('незнакомой почте письма нет, а ответ тот же', async () => {
    const { endpoints, sent } = setup()
    const r = await call(endpoints, '/cms/auth/code', reqOf({ email: 'guest@mail.ru' }))
    expect(r).toMatchObject({ status: 200, body: { ok: true } })
    expect(sent).toEqual([])
  })

  it('повторный запрос сразу — 429 cooldown; чужой origin — 403', async () => {
    const { endpoints } = setup()
    await call(endpoints, '/cms/auth/code', reqOf({ email: KASSA.email }))
    const again = await call(endpoints, '/cms/auth/code', reqOf({ email: KASSA.email }))
    expect(again).toMatchObject({ status: 429, body: { code: 'cooldown' } })
    const foreign = await call(
      endpoints,
      '/cms/auth/code',
      reqOf({ email: KASSA.email }, 'https://evil.test'),
    )
    expect(foreign.status).toBe(403)
  })
})

describe('POST /cms/auth/login', () => {
  it('верный код из письма начинает сессию (cookie) и пишет вход в журнал', async () => {
    const { endpoints, sessions, audit } = setup()
    await call(endpoints, '/cms/auth/code', reqOf({ email: KASSA.email }))
    const r = await call(
      endpoints,
      '/cms/auth/login',
      reqOf({ email: 'KASSA@turdus.ru', code: '424242' }),
    )
    expect(r.status).toBe(200)
    expect(r.res.headers.get('set-cookie')).toContain('payload-token=')
    expect(sessions).toEqual([KASSA])
    expect(audit).toEqual([
      { action: 'cms.login.email_code', entity: 'admin-users', entityId: '7', result: 'ok' },
    ])
  })

  it('неверный код — 400 без сессии, отказ в журнале; код нельзя использовать дважды', async () => {
    const { endpoints, sessions, audit } = setup()
    await call(endpoints, '/cms/auth/code', reqOf({ email: KASSA.email }))
    const wrong = await call(
      endpoints,
      '/cms/auth/login',
      reqOf({ email: KASSA.email, code: '000000' }),
    )
    expect(wrong).toMatchObject({ status: 400, body: { code: 'invalid_code' } })
    expect(audit.at(-1)?.result).toBe('denied')
    await call(endpoints, '/cms/auth/login', reqOf({ email: KASSA.email, code: '424242' }))
    const reused = await call(
      endpoints,
      '/cms/auth/login',
      reqOf({ email: KASSA.email, code: '424242' }),
    )
    expect(reused.status).toBe(400)
    expect(sessions).toHaveLength(1)
  })

  it('незнакомая почта — тот же ответ invalid_code, без сессии', async () => {
    const { endpoints, sessions } = setup()
    const r = await call(
      endpoints,
      '/cms/auth/login',
      reqOf({ email: 'guest@mail.ru', code: '424242' }),
    )
    expect(r).toMatchObject({ status: 400, body: { code: 'invalid_code' } })
    expect(sessions).toEqual([])
  })
})

describe('blockPasswordLogin', () => {
  const reqAt = (url: string) => ({ url }) as unknown as PayloadRequest

  it('вход по паролю закрыт', () => {
    expect(() =>
      blockPasswordLogin({ req: reqAt('https://cms.test/api/admin-users/login') }),
    ).toThrow(PASSWORD_LOGIN_DISABLED)
  })

  it('создание первого пользователя (вход сразу после регистрации) разрешено', () => {
    expect(() =>
      blockPasswordLogin({ req: reqAt('https://cms.test/api/admin-users/first-register') }),
    ).not.toThrow()
  })
})

describe('супер-админ: почта + код из приложения', () => {
  const now = () => totpAt(SUPER.secret, new Date())

  it('письмо не отправляется, ответ тот же', async () => {
    const { endpoints, sent } = setup({ superAdmin: SUPER })
    const r = await call(endpoints, '/cms/auth/code', reqOf({ email: 'Owner@Turdus.ru' }))
    expect(r).toMatchObject({ status: 200, body: { ok: true } })
    expect(sent).toEqual([])
  })

  it('верный код из приложения — сессия и сразу пройденный второй фактор', async () => {
    const { endpoints, sessions, audit } = setup({ superAdmin: SUPER })
    const r = await call(endpoints, '/cms/auth/login', reqOf({ email: SUPER.email, code: now() }))
    expect(r.status).toBe(200)
    const cookies = r.res.headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    expect(cookies[0]).toContain('payload-token=')
    expect(cookies[1]).toContain('trds-cms-mfa=1.sid-1')
    expect(sessions).toEqual([OWNER])
    expect(audit.at(-1)).toMatchObject({ action: 'cms.login.superadmin', result: 'ok' })
  })

  it('тот же код второй раз не принимается', async () => {
    const { endpoints, sessions } = setup({ superAdmin: SUPER })
    const code = now()
    await call(endpoints, '/cms/auth/login', reqOf({ email: SUPER.email, code }))
    const again = await call(endpoints, '/cms/auth/login', reqOf({ email: SUPER.email, code }))
    expect(again).toMatchObject({ status: 400, body: { code: 'invalid_code' } })
    expect(sessions).toHaveLength(1)
  })

  it('неверный код — отказ в журнале; после 5 ошибок — блокировка даже с верным кодом', async () => {
    const { endpoints, sessions, audit } = setup({ superAdmin: SUPER })
    for (let i = 0; i < 5; i++) {
      const r = await call(
        endpoints,
        '/cms/auth/login',
        reqOf({ email: SUPER.email, code: '000000' }),
      )
      expect(r.status).toBe(400)
    }
    expect(audit.filter((a) => a.result === 'denied')).toHaveLength(5)
    const locked = await call(
      endpoints,
      '/cms/auth/login',
      reqOf({ email: SUPER.email, code: now() }),
    )
    expect(locked.status).toBe(429)
    expect(sessions).toEqual([])
  })

  it('код из письма супер-админу не подходит', async () => {
    const { endpoints, sessions } = setup({ superAdmin: SUPER })
    const r = await call(
      endpoints,
      '/cms/auth/login',
      reqOf({ email: SUPER.email, code: '424242' }),
    )
    expect(r.status).toBe(400)
    expect(sessions).toEqual([])
  })
})

describe('parseSuperAdminConfig', () => {
  it('пустые переменные — режим выключен', () => {
    expect(parseSuperAdminConfig({})).toBeNull()
    expect(parseSuperAdminConfig({ SUPERADMIN_EMAIL: 'a@b.ru' })).toBeNull()
  })

  it('слишком короткий или не base32 секрет — выключен', () => {
    expect(
      parseSuperAdminConfig({ SUPERADMIN_EMAIL: 'a@b.ru', SUPERADMIN_TOTP_SECRET: 'ABCD' }),
    ).toBeNull()
    expect(
      parseSuperAdminConfig({ SUPERADMIN_EMAIL: 'a@b.ru', SUPERADMIN_TOTP_SECRET: '1'.repeat(32) }),
    ).toBeNull()
  })

  it('почта в нижнем регистре, секрет без пробелов', () => {
    const secret = generateTotpSecret()
    const spaced = secret.toLowerCase().replace(/(.{4})/g, '$1 ')
    expect(
      parseSuperAdminConfig({
        SUPERADMIN_EMAIL: ' Owner@Turdus.RU ',
        SUPERADMIN_TOTP_SECRET: spaced,
      }),
    ).toEqual({ email: 'owner@turdus.ru', secret })
  })
})

describe('супер-админ: единый постоянный код', () => {
  const STATIC: SuperAdminConfig = { email: SUPER.email, code: '73915824' }

  it('верный код — сессия с пройденным вторым фактором, и код работает повторно', async () => {
    const { endpoints, sessions } = setup({ superAdmin: STATIC })
    for (let i = 0; i < 2; i++) {
      const r = await call(
        endpoints,
        '/cms/auth/login',
        reqOf({ email: SUPER.email, code: '73915824' }),
      )
      expect(r.status).toBe(200)
      expect(r.res.headers.getSetCookie()[1]).toContain('trds-cms-mfa=')
    }
    expect(sessions).toHaveLength(2)
  })

  it('неверный код и код из приложения не подходят; 5 ошибок — блокировка', async () => {
    const { endpoints, sessions } = setup({ superAdmin: STATIC })
    for (const code of ['73915825', '7391582', '000000', '11111111', '22222222']) {
      const r = await call(endpoints, '/cms/auth/login', reqOf({ email: SUPER.email, code }))
      expect(r.status).toBe(400)
    }
    const locked = await call(
      endpoints,
      '/cms/auth/login',
      reqOf({ email: SUPER.email, code: '73915824' }),
    )
    expect(locked.status).toBe(429)
    expect(sessions).toEqual([])
  })

  it('SUPERADMIN_CODE важнее секрета; неверный формат кода — откат на приложение', () => {
    const secret = generateTotpSecret()
    expect(
      parseSuperAdminConfig({
        SUPERADMIN_EMAIL: 'a@b.ru',
        SUPERADMIN_CODE: ' 12345678 ',
        SUPERADMIN_TOTP_SECRET: secret,
      }),
    ).toEqual({ email: 'a@b.ru', code: '12345678' })
    expect(
      parseSuperAdminConfig({
        SUPERADMIN_EMAIL: 'a@b.ru',
        SUPERADMIN_CODE: '123456',
        SUPERADMIN_TOTP_SECRET: secret,
      }),
    ).toEqual({ email: 'a@b.ru', secret })
    expect(
      parseSuperAdminConfig({ SUPERADMIN_EMAIL: 'a@b.ru', SUPERADMIN_CODE: 'abcdefgh' }),
    ).toBeNull()
  })
})
