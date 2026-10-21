import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'

import { CODE_LENGTH } from '@/modules/auth'

/**
 * Вход по одноразовому коду и сессии (PRD 5.5, T-050, rules.md §Безопасность).
 * Только сервер. Код хранится HMAC-хешем, одноразовый, с TTL, лимитом попыток и отправки;
 * ответ на запрос кода одинаков для любой почты. Сессия — случайный токен в HttpOnly cookie,
 * в базе только его SHA-256. Хранилище — интерфейс `AuthStore` (PostgreSQL или память в тестах).
 */

export const OTP_RULES = {
  ttlSec: 10 * 60,
  resendAfterSec: 60,
  maxSendsPerHour: 5,
  maxAttempts: 5,
  sessionDays: 30,
} as const

export type CodePurpose = 'login' | 'register'

export type CodeRow = {
  id: string
  email: string
  codeHash: string
  purpose: CodePurpose
  name: string | null
  /** Хеш пароля из регистрации — переносится покупателю после подтверждения почты. */
  passwordHash: string | null
  attempts: number
  expiresAt: Date
  consumedAt: Date | null
  createdAt: Date
}

export type Customer = { id: string; email: string; name: string | null }

/** Покупатель в хранилище — с хешем пароля (наружу не отдаётся). */
export type CustomerRecord = Customer & { passwordHash: string | null }

export type SessionRow = {
  id: string
  tokenHash: string
  customerId: string
  expiresAt: Date
  revokedAt: Date | null
  createdAt: Date
}

export interface AuthStore {
  insertCode(row: CodeRow): Promise<void>
  /** Коды почты, созданные не раньше `since`, новые первыми. */
  codesSince(email: string, since: Date): Promise<CodeRow[]>
  /** Попытка +1; возвращает новое число попыток. */
  addAttempt(id: string): Promise<number>
  /** Погасить код, только если он ещё не погашен (защита от гонки). true — погасили мы. */
  consumeCode(id: string, at: Date): Promise<boolean>
  findCustomer(email: string): Promise<CustomerRecord | null>
  insertCustomer(customer: CustomerRecord & { createdAt: Date }): Promise<CustomerRecord>
  setCustomerName(id: string, name: string): Promise<void>
  /** Задать пароль, только если его ещё нет. */
  setCustomerPassword(id: string, passwordHash: string): Promise<void>
  insertSession(row: SessionRow): Promise<void>
  findSession(tokenHash: string): Promise<(SessionRow & { customer: Customer }) | null>
  revokeSession(tokenHash: string, at: Date): Promise<void>
}

export type SentCode = { email: string; code: string; purpose: CodePurpose }

type Deps = {
  store: AuthStore
  /** Секрет HMAC для кодов (из env, ≥ 32 символов). */
  secret: string
  sendCode: (message: SentCode) => Promise<void>
  now?: () => Date
  randomCode?: () => string
}

export type RequestResult =
  | { ok: true }
  | { ok: false; error: 'cooldown'; retryAfter: number }
  | { ok: false; error: 'too_many'; retryAfter: number }

export type VerifyResult =
  | { ok: true; customer: Customer; session: { token: string; expiresAt: Date } }
  | { ok: false; error: 'invalid' }

const normalizeEmail = (email: string) => email.trim().toLowerCase()

// Пароль: scrypt (встроен в Node, рекомендован OWASP), соль 16 байт; формат scrypt$N$r$p$salt$hash.
const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 32 }
const derive = (password: string, salt: Buffer, params = SCRYPT) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password.normalize('NFKC'),
      salt,
      params.keylen,
      { N: params.N, r: params.r, p: params.p },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  )

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const key = await derive(password, salt)
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$')
}

async function checkPassword(password: string, stored: string | null) {
  const parts = stored?.split('$')
  if (!parts || parts.length !== 6 || parts[0] !== 'scrypt') {
    // Нет пароля или почты — всё равно считаем хеш: время ответа не выдаёт, есть ли аккаунт.
    await derive(password, Buffer.alloc(16))
    return false
  }
  const [, N, r, p, salt, hash] = parts
  const expected = Buffer.from(hash!, 'base64url')
  const key = await derive(password, Buffer.from(salt!, 'base64url'), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    keylen: expected.length,
  })
  return key.length === expected.length && timingSafeEqual(key, expected)
}
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export function createAuthService({
  store,
  secret,
  sendCode,
  now = () => new Date(),
  randomCode = () => String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0'),
}: Deps) {
  const hashCode = (email: string, code: string) =>
    createHmac('sha256', secret).update(`${email}:${code}`).digest('hex')

  const sameHash = (a: string, b: string) => {
    const x = Buffer.from(a, 'hex')
    const y = Buffer.from(b, 'hex')
    return x.length === y.length && timingSafeEqual(x, y)
  }

  async function requestCode(input: {
    email: string
    purpose: CodePurpose
    name?: string
    /** Только при регистрации; хранится хешем и задаётся после подтверждения почты. */
    password?: string
  }): Promise<RequestResult> {
    const email = normalizeEmail(input.email)
    const at = now()
    const recent = await store.codesSince(email, new Date(at.getTime() - 3_600_000))
    const last = recent[0]
    if (last) {
      const wait =
        OTP_RULES.resendAfterSec - Math.floor((at.getTime() - last.createdAt.getTime()) / 1000)
      if (wait > 0) return { ok: false, error: 'cooldown', retryAfter: wait }
    }
    if (recent.length >= OTP_RULES.maxSendsPerHour) {
      const oldest = recent.at(-1)!
      const retryAfter = Math.ceil((oldest.createdAt.getTime() + 3_600_000 - at.getTime()) / 1000)
      return { ok: false, error: 'too_many', retryAfter }
    }
    const code = randomCode()
    await store.insertCode({
      id: randomUUID(),
      email,
      codeHash: hashCode(email, code),
      purpose: input.purpose,
      name: input.name?.trim() || null,
      passwordHash: input.password ? await hashPassword(input.password) : null,
      attempts: 0,
      expiresAt: new Date(at.getTime() + OTP_RULES.ttlSec * 1000),
      consumedAt: null,
      createdAt: at,
    })
    // Ответ не зависит от того, есть ли такой покупатель: аккаунты не перечислить.
    await sendCode({ email, code, purpose: input.purpose })
    return { ok: true }
  }

  async function verifyCode(input: { email: string; code: string }): Promise<VerifyResult> {
    const email = normalizeEmail(input.email)
    const at = now()
    const fail = { ok: false, error: 'invalid' } as const
    if (!/^\d+$/.test(input.code) || input.code.length !== CODE_LENGTH) return fail
    const [latest] = await store.codesSince(email, new Date(at.getTime() - OTP_RULES.ttlSec * 1000))
    if (
      !latest ||
      latest.consumedAt ||
      latest.expiresAt <= at ||
      latest.attempts >= OTP_RULES.maxAttempts
    )
      return fail
    if (!sameHash(latest.codeHash, hashCode(email, input.code))) {
      await store.addAttempt(latest.id)
      return fail
    }
    if (!(await store.consumeCode(latest.id, at))) return fail

    let record = await store.findCustomer(email)
    if (!record)
      record = await store.insertCustomer({
        id: randomUUID(),
        email,
        name: latest.name,
        passwordHash: latest.passwordHash,
        createdAt: at,
      })
    else {
      if (!record.name && latest.name) {
        await store.setCustomerName(record.id, latest.name)
        record = { ...record, name: latest.name }
      }
      // Пароль из повторной регистрации не перезаписывает уже заданный.
      if (!record.passwordHash && latest.passwordHash)
        await store.setCustomerPassword(record.id, latest.passwordHash)
    }
    return openSession({ id: record.id, email: record.email, name: record.name }, at)
  }

  async function openSession(customer: Customer, at: Date): Promise<VerifyResult> {
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(at.getTime() + OTP_RULES.sessionDays * 86_400_000)
    await store.insertSession({
      id: randomUUID(),
      tokenHash: sha256(token),
      customerId: customer.id,
      expiresAt,
      revokedAt: null,
      createdAt: at,
    })
    return { ok: true, customer, session: { token, expiresAt } }
  }

  /** Вход по паролю (T-055): одинаковый ответ для неверного пароля и неизвестной почты. */
  async function passwordLogin(input: { email: string; password: string }): Promise<VerifyResult> {
    const email = normalizeEmail(input.email)
    const record = await store.findCustomer(email)
    if (!(await checkPassword(input.password, record?.passwordHash ?? null)) || !record)
      return { ok: false, error: 'invalid' }
    return openSession({ id: record.id, email: record.email, name: record.name }, now())
  }

  async function getSession(token: string | undefined) {
    if (!token || !/^[\w-]{43}$/.test(token)) return null
    const row = await store.findSession(sha256(token))
    if (!row || row.revokedAt || row.expiresAt <= now()) return null
    return { customer: row.customer, expiresAt: row.expiresAt }
  }

  async function logout(token: string | undefined) {
    if (!token || !/^[\w-]{43}$/.test(token)) return
    await store.revokeSession(sha256(token), now())
  }

  return { requestCode, verifyCode, passwordLogin, getSession, logout }
}

export type AuthService = ReturnType<typeof createAuthService>

/** Хранилище в памяти — для тестов и превью без базы. Не для production. */
export function memoryAuthStore(): AuthStore & {
  dump: () => { codes: CodeRow[]; sessions: SessionRow[]; customers: CustomerRecord[] }
} {
  const codes: CodeRow[] = []
  const customers: CustomerRecord[] = []
  const sessions: SessionRow[] = []
  return {
    async insertCode(row) {
      codes.push({ ...row })
    },
    async codesSince(email, since) {
      return codes
        .filter((c) => c.email === email && c.createdAt >= since)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((c) => ({ ...c }))
    },
    async addAttempt(id) {
      const c = codes.find((x) => x.id === id)!
      c.attempts += 1
      return c.attempts
    },
    async consumeCode(id, at) {
      const c = codes.find((x) => x.id === id)
      if (!c || c.consumedAt) return false
      c.consumedAt = at
      return true
    },
    async findCustomer(email) {
      const c = customers.find((x) => x.email === email)
      return c ? { ...c } : null
    },
    async insertCustomer({ id, email, name, passwordHash }) {
      const c = { id, email, name, passwordHash }
      customers.push(c)
      return { ...c }
    },
    async setCustomerName(id, name) {
      customers.find((x) => x.id === id)!.name = name
    },
    async setCustomerPassword(id, passwordHash) {
      const c = customers.find((x) => x.id === id)!
      c.passwordHash ??= passwordHash
    },
    async insertSession(row) {
      sessions.push({ ...row })
    },
    async findSession(tokenHash) {
      const s = sessions.find((x) => x.tokenHash === tokenHash)
      const c = s && customers.find((x) => x.id === s.customerId)
      return s && c ? { ...s, customer: { id: c.id, email: c.email, name: c.name } } : null
    },
    async revokeSession(tokenHash, at) {
      const s = sessions.find((x) => x.tokenHash === tokenHash)
      if (s && !s.revokedAt) s.revokedAt = at
    },
    dump: () => ({
      codes: codes.map((c) => ({ ...c })),
      sessions: sessions.map((s) => ({ ...s })),
      customers,
    }),
  }
}
