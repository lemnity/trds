import type { Endpoint, PayloadRequest } from 'payload'

import { writeCmsAudit, type CmsAuditWriter } from '../audit'
import {
  ADMIN_USERS_SLUG,
  activeStaff,
  isSystemAdmin,
  mfaRequired,
  mfaVerified,
  type StaffUser,
} from '../access/roles'
import {
  createMfaService,
  MFA_COOKIE,
  MFA_COOKIE_MAX_AGE_S,
  mfaKeysFromEnv,
  signMfaCookie,
  type MfaService,
} from './mfa'
import { payloadMfaStore } from './mfaStore'

/**
 * REST второго фактора: /api/admin-users/mfa/*. Пароль проверяет Payload (обычный вход), затем
 * сотрудник с обязательной MFA получает права только после /mfa/verify (или /mfa/setup/confirm):
 * до этого access layer считает его анонимом (src/payload/access/roles.ts).
 */

export type MfaEndpointDeps = {
  service: (req: PayloadRequest) => MfaService
  audit: CmsAuditWriter
  setMfaFlag: (req: PayloadRequest, id: StaffUser['id'] | string, enabled: boolean) => Promise<void>
  now: () => Date
}

const defaultDeps: MfaEndpointDeps = {
  service: (req) =>
    createMfaService({ store: payloadMfaStore(req.payload), keys: mfaKeysFromEnv() }),
  audit: writeCmsAudit,
  setMfaFlag: async (req, id, enabled) => {
    await req.payload.update({
      collection: ADMIN_USERS_SLUG,
      id,
      data: { mfaEnabled: enabled },
      overrideAccess: true,
      context: { mfaInternal: true },
    })
  },
  now: () => new Date(),
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })

/** Изменяющие запросы с cookie — только со своего origin (CSRF, rules.md §4). */
const sameOrigin = (req: PayloadRequest) => {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).host === req.headers.get('host')
  } catch {
    return false
  }
}

const mfaCookie = (value: string, maxAge: number) =>
  [
    `${MFA_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
    ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
  ].join('; ')

const readBody = async (req: PayloadRequest): Promise<Record<string, unknown>> => {
  try {
    const body = (await req.json?.()) as unknown
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 64) : '')

const sessionStaff = (req: PayloadRequest) => {
  const user = req.user as StaffUser | null
  return user?.collection === ADMIN_USERS_SLUG && user._sid ? user : null
}

const verifiedCookie = (user: StaffUser, now: Date) => {
  const expiresAt = new Date(now.getTime() + MFA_COOKIE_MAX_AGE_S * 1000)
  return mfaCookie(
    signMfaCookie({ userId: String(user.id), sid: user._sid!, expiresAt }, mfaKeysFromEnv().cookie),
    MFA_COOKIE_MAX_AGE_S,
  )
}

const ERROR_STATUS = {
  INVALID_CODE: 400,
  LOCKED: 429,
  NOT_ENROLLED: 409,
  ALREADY_ENROLLED: 409,
  NO_SETUP: 409,
} as const

export function mfaEndpoints(overrides: Partial<MfaEndpointDeps> = {}): Endpoint[] {
  const { service, audit, setMfaFlag, now } = { ...defaultDeps, ...overrides }

  /** Обёртка: сотрудник с сессией Payload; для POST — запрос со своего origin. */
  const guard =
    (
      method: 'get' | 'post',
      fn: (req: PayloadRequest, user: StaffUser) => Promise<Response>,
    ): Endpoint['handler'] =>
    async (req) => {
      const user = sessionStaff(req)
      if (!user) return json({ error: 'unauthorized' }, 401)
      if (method === 'post' && !sameOrigin(req)) return json({ error: 'forbidden' }, 403)
      return fn(req, user)
    }

  const userAudit = (
    req: PayloadRequest,
    entityId: string,
    action: string,
    result: 'ok' | 'denied',
    reason?: string,
  ) => audit(req, { action, entity: ADMIN_USERS_SLUG, entityId, result, reason })

  return [
    {
      path: '/mfa/status',
      method: 'get',
      handler: guard('get', async (req, user) => {
        const status = await service(req).status(String(user.id), now())
        return json({
          required: mfaRequired(user),
          verified: mfaVerified(req, user, now()),
          ...status,
        })
      }),
    },
    {
      path: '/mfa/setup',
      method: 'post',
      handler: guard('post', async (req, user) => {
        const result = await service(req).beginSetup(String(user.id), user.email ?? String(user.id))
        if (!result.ok) return json({ error: result.error }, ERROR_STATUS[result.error])
        return json({ secret: result.secret, otpauthUrl: result.otpauthUrl })
      }),
    },
    {
      path: '/mfa/setup/confirm',
      method: 'post',
      handler: guard('post', async (req, user) => {
        const body = await readBody(req)
        const at = now()
        const result = await service(req).confirmSetup(String(user.id), str(body.code), at)
        if (!result.ok) return json({ error: result.error }, ERROR_STATUS[result.error])
        await setMfaFlag(req, user.id, true)
        await userAudit(req, String(user.id), 'cms.mfa.enable', 'ok')
        return json({ recoveryCodes: result.recoveryCodes }, 200, {
          'Set-Cookie': verifiedCookie(user, at),
        })
      }),
    },
    {
      path: '/mfa/verify',
      method: 'post',
      handler: guard('post', async (req, user) => {
        const body = await readBody(req)
        const at = now()
        const input =
          typeof body.recoveryCode === 'string'
            ? { recoveryCode: str(body.recoveryCode) }
            : { code: str(body.code) }
        const result = await service(req).verify(String(user.id), input, at)
        if (!result.ok) {
          await userAudit(req, String(user.id), 'cms.mfa.verify', 'denied', result.error)
          return json({ error: result.error }, ERROR_STATUS[result.error])
        }
        if (result.method === 'recovery')
          await userAudit(
            req,
            String(user.id),
            'cms.mfa.recovery_code_used',
            'ok',
            `left: ${result.recoveryCodesLeft}`,
          )
        return json({ method: result.method, recoveryCodesLeft: result.recoveryCodesLeft }, 200, {
          'Set-Cookie': verifiedCookie(user, at),
        })
      }),
    },
    {
      path: '/mfa/recovery-codes',
      method: 'post',
      handler: guard('post', async (req, user) => {
        if (!mfaVerified(req, user, now())) return json({ error: 'mfa_required' }, 403)
        const codes = await service(req).regenerateRecoveryCodes(String(user.id))
        await userAudit(req, String(user.id), 'cms.mfa.recovery_codes_regenerated', 'ok')
        return json({ recoveryCodes: codes })
      }),
    },
    {
      // Свой сброс — после второго фактора (в том числе по коду восстановления, если телефон
      // утерян); чужой — только системный администратор и с причиной.
      path: '/mfa/reset',
      method: 'post',
      handler: guard('post', async (req, user) => {
        const body = await readBody(req)
        const target = body.userId === undefined ? String(user.id) : String(body.userId)
        const self = target === String(user.id)
        const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
        if (self ? !mfaVerified(req, user, now()) : !isSystemAdmin(activeStaff(req))) {
          await userAudit(req, target, 'cms.mfa.reset', 'denied')
          return json({ error: 'forbidden' }, 403)
        }
        if (!self && !reason) return json({ error: 'reason_required' }, 400)
        await service(req).reset(target)
        await setMfaFlag(req, target, false)
        await userAudit(req, target, 'cms.mfa.reset', 'ok', reason || 'self')
        return json({ ok: true }, 200, self ? { 'Set-Cookie': mfaCookie('', 0) } : {})
      }),
    },
  ]
}
