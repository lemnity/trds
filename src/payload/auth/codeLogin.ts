import { APIError, getFieldsToSign, jwtSign } from 'payload'
import type { Endpoint, PayloadRequest, TypedUser } from 'payload'
import { addSessionToUser, generatePayloadCookie } from 'payload/shared'
import { z } from 'zod'

import { sharedRateLimiter, type RateLimiter } from '@/lib/rate-limit'
import type { AuthService } from '@/modules/accounts/service'

import { ADMIN_USERS_SLUG } from '../access/roles'
import { writeCmsAudit, type CmsAuditWriter } from '../audit'
import { json, readBody, sameOrigin } from '../endpoints/http'
import { mfaVerifiedCookie } from './endpoints'
import { createSuperAdminVerifier, superAdminFromEnv, type SuperAdminConfig } from './superAdmin'

/**
 * Вход сотрудника без пароля: почта → код из письма (здесь) → код из приложения (экран /admin/mfa,
 * src/payload/auth/endpoints.ts). Пароль Payload не используется: вход по нему закрыт хуком
 * `blockPasswordLogin` (кроме создания первого пользователя). Сессию выдаём теми же функциями,
 * что и обычный вход Payload, — дальше всё (MfaGate, выход, отзыв сессий) работает как раньше.
 *
 *   POST /api/cms/auth/code   { email }        → 200 { ok } (одинаково для любой почты)
 *   POST /api/cms/auth/login  { email, code }  → 200 { ok } + cookie сессии; 400 invalid_code
 *
 * Супер-админ из .env (src/payload/auth/superAdmin.ts): письмо ему не отправляется, а в /login
 * вместо кода из письма он вводит код из приложения — и сразу получает сессию с пройденным
 * вторым фактором. Ответы /code одинаковые, по ним почту супер-админа не узнать.
 */

export type StaffDoc = TypedUser & { id: number | string; email: string }

export type CodeLoginDeps = {
  accounts: () => Promise<Pick<AuthService, 'requestCode' | 'verifyStaffCode'>>
  findStaff: (req: PayloadRequest, email: string) => Promise<StaffDoc | null>
  /** Начать сессию Payload; вернуть заголовок Set-Cookie и id сессии. */
  issueSession: (req: PayloadRequest, user: StaffDoc) => Promise<{ cookie: string; sid: string }>
  audit: CmsAuditWriter
  superAdmin: () => SuperAdminConfig | null
  /** Код из приложения супер-админа (с защитой от повтора). */
  verifySuperAdminCode: (config: SuperAdminConfig, code: string) => boolean
  /** Найти сотрудника супер-админа или создать его (администратор театра + системный). */
  ensureSuperAdmin: (req: PayloadRequest, email: string) => Promise<StaffDoc>
  /** Set-Cookie «второй фактор пройден». */
  mfaCookie: (userId: string, sid: string) => string
  /** Неверные коды супер-админа: общий лимит, не зависящий от IP. */
  superAdminFailures: RateLimiter
  requestsByIp: RateLimiter
  loginsByIp: RateLimiter
}

const clientIp = (req: PayloadRequest) =>
  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'

const emailSchema = z.string().trim().toLowerCase().pipe(z.email())
// 6 цифр — код из письма или приложения; до 12 — постоянный код супер-админа.
const loginSchema = z.object({ email: emailSchema, code: z.string().regex(/^\d{6,12}$/) })

const defaultDeps: CodeLoginDeps = {
  // Динамический импорт: модуль аккаунтов тянет payload.config (цикл с конфигом).
  accounts: async () => (await (await import('@/modules/accounts')).getAccounts()).auth,
  findStaff: async (req, email) => {
    const doc = (await req.payload.db.findOne({
      collection: ADMIN_USERS_SLUG,
      req,
      where: { email: { equals: email } },
    })) as (StaffDoc & { hash?: unknown; salt?: unknown }) | null
    if (!doc) return null
    // Как во входе Payload: хеш и соль пароля не попадают в документ сессии.
    const user = { ...doc }
    delete user.hash
    delete user.salt
    return user
  },
  issueSession: async (req, user) => {
    const collectionConfig = req.payload.collections[ADMIN_USERS_SLUG].config
    const { sid } = await addSessionToUser({ collectionConfig, payload: req.payload, req, user })
    const { token } = await jwtSign({
      fieldsToSign: getFieldsToSign({ collectionConfig, email: user.email, sid, user }),
      secret: req.payload.secret,
      tokenExpiration: collectionConfig.auth.tokenExpiration,
    })
    const cookie = generatePayloadCookie({
      collectionAuthConfig: collectionConfig.auth,
      cookiePrefix: req.payload.config.cookiePrefix,
      token,
    }) as string
    // Без sid второй фактор не к чему привязать (roles.ts: mfaVerified).
    if (!sid) throw new Error('payload sessions are disabled for admin users')
    return { cookie, sid }
  },
  audit: writeCmsAudit,
  superAdmin: superAdminFromEnv,
  verifySuperAdminCode: createSuperAdminVerifier(),
  ensureSuperAdmin: async (req, email) => {
    const found = await defaultDeps.findStaff(req, email)
    if (found) return found
    // Без пользователя в req хуки считают это доверенным серверным кодом; пароль задаст
    // beforeValidate (случайный — вход по паролю всё равно закрыт).
    await req.payload.create({
      collection: ADMIN_USERS_SLUG,
      data: { email, role: 'admin', systemAdmin: true },
      overrideAccess: true,
    })
    const created = await defaultDeps.findStaff(req, email)
    if (!created) throw new Error('super admin was not created')
    return created
  },
  mfaCookie: (userId, sid) => mfaVerifiedCookie(userId, sid),
  superAdminFailures: sharedRateLimiter({
    name: 'cms.superadmin.fail',
    limit: 5,
    windowMs: 15 * 60_000,
  }),
  requestsByIp: sharedRateLimiter({
    name: 'cms.code_request.ip',
    limit: 20,
    windowMs: 10 * 60_000,
  }),
  loginsByIp: sharedRateLimiter({ name: 'cms.code_login.ip', limit: 30, windowMs: 10 * 60_000 }),
}

const INVALID_CODE = { code: 'invalid_code', message: 'Неверный или устаревший код.' }
const TOO_MANY = { code: 'too_many', message: 'Слишком много попыток. Попробуйте позже.' }
const FORBIDDEN = { code: 'forbidden', message: 'Запрещено.' }

export function codeLoginEndpoints(overrides: Partial<CodeLoginDeps> = {}): Endpoint[] {
  const deps = { ...defaultDeps, ...overrides }

  const superAdminLogin = async (req: PayloadRequest, config: SuperAdminConfig, code: string) => {
    const audit = (result: 'ok' | 'denied', entityId: string) =>
      deps.audit(req, {
        action: 'cms.login.superadmin',
        entity: ADMIN_USERS_SLUG,
        entityId,
        result,
      })
    if (!(await deps.superAdminFailures.allowed('superadmin'))) return json(TOO_MANY, 429)
    if (!deps.verifySuperAdminCode(config, code)) {
      await deps.superAdminFailures.hit('superadmin')
      await audit('denied', 'superadmin')
      return json(INVALID_CODE, 400)
    }
    const staff = await deps.ensureSuperAdmin(req, config.email)
    const session = await deps.issueSession(req, staff)
    await audit('ok', String(staff.id))
    const headers = new Headers({ 'Cache-Control': 'no-store' })
    headers.append('Set-Cookie', session.cookie)
    headers.append('Set-Cookie', deps.mfaCookie(String(staff.id), session.sid))
    return Response.json({ ok: true }, { headers })
  }

  return [
    {
      path: '/cms/auth/code',
      method: 'post',
      handler: async (req) => {
        if (!sameOrigin(req)) return json(FORBIDDEN, 403)
        if (!(await deps.requestsByIp.hit(clientIp(req)))) return json(TOO_MANY, 429)
        const email = emailSchema.safeParse((await readBody(req)).email)
        if (!email.success) return json({ code: 'invalid', message: 'Проверьте почту.' }, 400)
        // Супер-админ входит по коду из приложения — письмо не нужно.
        if (deps.superAdmin()?.email === email.data) return json({ ok: true })
        // Письмо — только сотруднику; ответ одинаковый, чтобы по нему нельзя было подобрать почты.
        if (!(await deps.findStaff(req, email.data))) return json({ ok: true })
        const auth = await deps.accounts()
        const result = await auth.requestCode({ email: email.data, purpose: 'staff' })
        if (!result.ok)
          return json(
            {
              code: result.error,
              message: result.error === 'cooldown' ? 'Код уже отправлен.' : 'Слишком много писем.',
              retryAfter: result.retryAfter,
            },
            429,
          )
        return json({ ok: true })
      },
    },
    {
      path: '/cms/auth/login',
      method: 'post',
      handler: async (req) => {
        if (!sameOrigin(req)) return json(FORBIDDEN, 403)
        if (!(await deps.loginsByIp.hit(clientIp(req)))) return json(TOO_MANY, 429)
        const input = loginSchema.safeParse(await readBody(req))
        if (!input.success) return json(INVALID_CODE, 400)
        const { email, code } = input.data
        const superAdmin = deps.superAdmin()
        if (superAdmin?.email === email) return superAdminLogin(req, superAdmin, code)
        const staff = await deps.findStaff(req, email)
        const valid = staff ? await (await deps.accounts()).verifyStaffCode({ email, code }) : false
        if (!staff || !valid) {
          if (staff)
            await deps.audit(req, {
              action: 'cms.login.email_code',
              entity: ADMIN_USERS_SLUG,
              entityId: String(staff.id),
              result: 'denied',
            })
          return json(INVALID_CODE, 400)
        }
        const { cookie } = await deps.issueSession(req, staff)
        await deps.audit(req, {
          action: 'cms.login.email_code',
          entity: ADMIN_USERS_SLUG,
          entityId: String(staff.id),
          result: 'ok',
        })
        return Response.json(
          { ok: true },
          { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': cookie } },
        )
      },
    },
  ]
}

export const PASSWORD_LOGIN_DISABLED =
  'Вход по паролю отключён: войдите по коду из письма и коду из приложения.'

/**
 * Хук `beforeLogin` сотрудников: вход по паролю закрыт. Исключение — создание первого
 * пользователя (Payload сразу входит им по паролю, иначе пустую админку не запустить).
 */
export const blockPasswordLogin = ({ req }: { req: PayloadRequest }) => {
  let path = ''
  try {
    path = new URL(req.url ?? '', 'http://local').pathname
  } catch {
    // нет адреса — считаем обычным входом
  }
  if (path.endsWith('/first-register')) return
  throw new APIError(PASSWORD_LOGIN_DISABLED, 403, undefined, true)
}
