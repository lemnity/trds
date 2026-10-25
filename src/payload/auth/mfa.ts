import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

import { base32Encode, generateTotpSecret, matchTotp, otpauthUrl } from './totp'

/**
 * Второй фактор сотрудников CMS (T-023, rules.md §4): TOTP + одноразовые коды восстановления.
 * Секрет TOTP хранится зашифрованным (AES-256-GCM), коды восстановления — только HMAC-хешами.
 * Ключи выводятся из PAYLOAD_SECRET (HKDF): его смена делает MFA недействительной — после
 * ротации секрета сотрудники проходят настройку заново.
 */

export const MFA_ISSUER = 'TURDUS CMS'
export const RECOVERY_CODES_COUNT = 10
/** Неудачных попыток подряд до временной блокировки. */
export const MFA_MAX_ATTEMPTS = 5
export const MFA_LOCK_MS = 15 * 60_000

export type MfaKeys = { enc: Buffer; hash: Buffer; cookie: Buffer }

export const deriveMfaKeys = (secret: string): MfaKeys => {
  if (secret.length < 32) throw new Error('PAYLOAD_SECRET is too short for MFA keys')
  const derive = (info: string) => Buffer.from(hkdfSync('sha256', secret, 'trds-cms-mfa', info, 32))
  return { enc: derive('totp-secret'), hash: derive('recovery-code'), cookie: derive('cookie') }
}

let envKeys: { secret: string; keys: MfaKeys } | undefined

/** Ключи из окружения процесса (кешируются, пока PAYLOAD_SECRET не изменился). */
export const mfaKeysFromEnv = (): MfaKeys => {
  const secret = process.env.PAYLOAD_SECRET ?? ''
  if (envKeys?.secret !== secret) envKeys = { secret, keys: deriveMfaKeys(secret) }
  return envKeys.keys
}

const b64 = (b: Buffer) => b.toString('base64url')

export const encryptSecret = (plain: string, key: Buffer): string => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', b64(iv), b64(cipher.getAuthTag()), b64(body)].join('.')
}

export const decryptSecret = (sealed: string, key: Buffer): string => {
  const [version, iv, tag, body] = sealed.split('.')
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('unsupported sealed secret')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/** Код восстановления: 10 символов base32 (50 бит) в виде «abcde-fghij». */
export const generateRecoveryCode = () => {
  const raw = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase()
  return `${raw.slice(0, 5)}-${raw.slice(5)}`
}

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[\s-]/g, '')

export const hashRecoveryCode = (code: string, key: Buffer) =>
  createHmac('sha256', key).update(normalizeRecoveryCode(code)).digest('hex')

export type MfaRecord = {
  /** Подтверждённый секрет (зашифрован). null — MFA не включена. */
  secret: string | null
  /** Секрет на этапе настройки, пока сотрудник не ввёл первый код. */
  pendingSecret: string | null
  /** Последний принятый шаг TOTP: тот же код повторно не принимается. */
  lastStep: number | null
  failedAttempts: number
  lockedUntil: Date | null
  enabledAt: Date | null
}

export interface MfaStore {
  get(userId: string): Promise<MfaRecord | null>
  upsert(userId: string, patch: Partial<MfaRecord>): Promise<void>
  /** Атомарно принимает шаг, только если он больше последнего принятого. */
  advanceStep(userId: string, step: number): Promise<boolean>
  replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void>
  /** Атомарно гасит код; false — кода нет или он уже использован. */
  consumeRecoveryCode(userId: string, hash: string, at: Date): Promise<boolean>
  remainingRecoveryCodes(userId: string): Promise<number>
  remove(userId: string): Promise<void>
}

export type MfaFailure =
  'INVALID_CODE' | 'LOCKED' | 'NOT_ENROLLED' | 'ALREADY_ENROLLED' | 'NO_SETUP'

export type VerifyInput = { code: string } | { recoveryCode: string }

export const emptyMfaRecord = (): MfaRecord => ({
  secret: null,
  pendingSecret: null,
  lastStep: null,
  failedAttempts: 0,
  lockedUntil: null,
  enabledAt: null,
})

const failure = <E extends MfaFailure>(error: E) => ({ ok: false as const, error })

export function createMfaService({ store, keys }: { store: MfaStore; keys: MfaKeys }) {
  const load = async (userId: string) => (await store.get(userId)) ?? emptyMfaRecord()
  const isLocked = (r: MfaRecord, now: Date) => r.lockedUntil !== null && r.lockedUntil > now

  async function fail(userId: string, r: MfaRecord, now: Date) {
    const failedAttempts = r.failedAttempts + 1
    if (failedAttempts >= MFA_MAX_ATTEMPTS)
      await store.upsert(userId, {
        failedAttempts: 0,
        lockedUntil: new Date(now.getTime() + MFA_LOCK_MS),
      })
    else await store.upsert(userId, { failedAttempts })
    return failure('INVALID_CODE')
  }

  async function issueRecoveryCodes(userId: string) {
    const codes = Array.from({ length: RECOVERY_CODES_COUNT }, generateRecoveryCode)
    await store.replaceRecoveryCodes(
      userId,
      codes.map((c) => hashRecoveryCode(c, keys.hash)),
    )
    return codes
  }

  /** Принимает TOTP-код: верный, в окне, и шаг ещё не использован (защита от повтора). */
  async function acceptTotp(userId: string, sealed: string, code: string, now: Date) {
    const step = matchTotp(decryptSecret(sealed, keys.enc), code, now)
    return step !== null && (await store.advanceStep(userId, step))
  }

  return {
    async status(userId: string, now = new Date()) {
      const r = await load(userId)
      return {
        enrolled: r.secret !== null,
        locked: isLocked(r, now),
        recoveryCodesLeft: r.secret ? await store.remainingRecoveryCodes(userId) : 0,
      }
    },

    /** Шаг 1 настройки: новый секрет (показывается один раз) и ссылка otpauth://. */
    async beginSetup(userId: string, account: string) {
      const r = await load(userId)
      if (r.secret) return failure('ALREADY_ENROLLED')
      const secret = generateTotpSecret()
      await store.upsert(userId, { pendingSecret: encryptSecret(secret, keys.enc) })
      return {
        ok: true as const,
        secret,
        otpauthUrl: otpauthUrl({ issuer: MFA_ISSUER, account, secret }),
      }
    },

    /** Шаг 2: первый код из приложения включает MFA и выдаёт коды восстановления. */
    async confirmSetup(userId: string, code: string, now = new Date()) {
      const r = await load(userId)
      if (r.secret) return failure('ALREADY_ENROLLED')
      if (!r.pendingSecret) return failure('NO_SETUP')
      if (isLocked(r, now)) return failure('LOCKED')
      if (!(await acceptTotp(userId, r.pendingSecret, code, now))) return fail(userId, r, now)
      await store.upsert(userId, {
        secret: r.pendingSecret,
        pendingSecret: null,
        failedAttempts: 0,
        lockedUntil: null,
        enabledAt: now,
      })
      return { ok: true as const, recoveryCodes: await issueRecoveryCodes(userId) }
    },

    /** Вход: код из приложения или один из кодов восстановления (гасится навсегда). */
    async verify(userId: string, input: VerifyInput, now = new Date()) {
      const r = await load(userId)
      if (!r.secret) return failure('NOT_ENROLLED')
      if (isLocked(r, now)) return failure('LOCKED')
      const accepted =
        'code' in input
          ? await acceptTotp(userId, r.secret, input.code, now)
          : await store.consumeRecoveryCode(
              userId,
              hashRecoveryCode(input.recoveryCode, keys.hash),
              now,
            )
      if (!accepted) return fail(userId, r, now)
      if (r.failedAttempts > 0 || r.lockedUntil)
        await store.upsert(userId, { failedAttempts: 0, lockedUntil: null })
      return {
        ok: true as const,
        method: 'code' in input ? ('totp' as const) : ('recovery' as const),
        recoveryCodesLeft: await store.remainingRecoveryCodes(userId),
      }
    },

    /** Новый набор кодов восстановления (старые перестают действовать). */
    regenerateRecoveryCodes: (userId: string) => issueRecoveryCodes(userId),

    /** Сброс MFA (утерян телефон): следующий вход потребует настройку заново. */
    reset: (userId: string) => store.remove(userId),
  }
}

export type MfaService = ReturnType<typeof createMfaService>

const safeEqualHex = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))

/** Хранилище в памяти — для тестов. */
export function memoryMfaStore(): MfaStore {
  const records = new Map<string, MfaRecord>()
  const codes = new Map<string, { hash: string; usedAt: Date | null }[]>()
  return {
    async get(userId) {
      const r = records.get(userId)
      return r ? { ...r } : null
    },
    async upsert(userId, patch) {
      records.set(userId, { ...(records.get(userId) ?? emptyMfaRecord()), ...patch })
    },
    async advanceStep(userId, step) {
      const r = records.get(userId)
      if (!r || (r.lastStep !== null && r.lastStep >= step)) return false
      r.lastStep = step
      return true
    },
    async replaceRecoveryCodes(userId, hashes) {
      codes.set(
        userId,
        hashes.map((hash) => ({ hash, usedAt: null })),
      )
    },
    async consumeRecoveryCode(userId, hash, at) {
      const row = codes.get(userId)?.find((c) => c.usedAt === null && safeEqualHex(c.hash, hash))
      if (!row) return false
      row.usedAt = at
      return true
    },
    async remainingRecoveryCodes(userId) {
      return (codes.get(userId) ?? []).filter((c) => c.usedAt === null).length
    },
    async remove(userId) {
      records.delete(userId)
      codes.delete(userId)
    },
  }
}

// --- Отметка «второй фактор пройден» для текущей сессии Payload ---

export const MFA_COOKIE = 'trds-cms-mfa'
/** Не дольше рабочего дня, даже если сессия Payload продлевается. */
export const MFA_COOKIE_MAX_AGE_S = 12 * 60 * 60

const sign = (body: string, key: Buffer) =>
  createHmac('sha256', key).update(body).digest('base64url')

/**
 * Cookie привязана к сотруднику и к id сессии Payload (`sid`): выход, отзыв сессии или новый
 * вход по паролю делают её недействительной — второй фактор нужно пройти снова.
 */
export const signMfaCookie = (
  { userId, sid, expiresAt }: { userId: string; sid: string; expiresAt: Date },
  key: Buffer,
) => {
  const body = Buffer.from(
    JSON.stringify({ u: userId, s: sid, e: Math.floor(expiresAt.getTime() / 1000) }),
  ).toString('base64url')
  return `${body}.${sign(body, key)}`
}

export const verifyMfaCookie = (
  value: string | undefined,
  key: Buffer,
  { userId, sid, now = new Date() }: { userId: string; sid: string; now?: Date },
): boolean => {
  if (!value) return false
  const [body, mac] = value.split('.')
  if (!body || !mac) return false
  const expected = sign(body, key)
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected)))
    return false
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      u?: unknown
      s?: unknown
      e?: unknown
    }
    return (
      claims.u === userId &&
      claims.s === sid &&
      typeof claims.e === 'number' &&
      claims.e * 1000 > now.getTime()
    )
  } catch {
    return false
  }
}

export const readCookie = (header: string | null | undefined, name: string) => {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return undefined
}
