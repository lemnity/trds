import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'

import { CODE_LENGTH, PASSWORD_MIN } from '@/modules/auth'

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

/** `password` — подтверждение почтой смены пароля в профиле (T-055); для входа не годится. */
export type CodePurpose = 'login' | 'register' | 'password'

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
  findCustomerById(id: string): Promise<CustomerRecord | null>
  insertCustomer(customer: CustomerRecord & { createdAt: Date }): Promise<CustomerRecord>
  setCustomerName(id: string, name: string): Promise<void>
  /** Задать пароль, только если его ещё нет. */
  setCustomerPassword(id: string, passwordHash: string): Promise<void>
  /** Заменить пароль (смена в профиле после проверки). */
  updateCustomerPassword(id: string, passwordHash: string): Promise<void>
  insertSession(row: SessionRow): Promise<void>
  findSession(tokenHash: string): Promise<(SessionRow & { customer: Customer }) | null>
  revokeSession(tokenHash: string, at: Date): Promise<void>
  /** Отозвать все живые сессии покупателя, кроме `exceptTokenHash` (если задан). */
  revokeCustomerSessions(customerId: string, at: Date, exceptTokenHash?: string): Promise<void>
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
  | {
      ok: true
      customer: Customer
      session: { token: string; expiresAt: Date }
      /** Покупатель создан этим входом (новая регистрация) — для приглашения друга (T-062). */
      created: boolean
    }
  | { ok: false; error: 'invalid' }

export type PasswordChangeResult =
  | { ok: true }
  | { ok: false; error: 'weak' | 'proof_required' | 'invalid_current' | 'invalid_code' | 'unknown' }

/** Наибольшая длина пароля (как в форме и API входа). */
export const PASSWORD_MAX = 128

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

  /**
   * Проверить и погасить последний код почты нужного назначения. Действует только последний
   * выданный код: новый запрос (любого назначения) делает прежний недействительным.
   */
  async function consumeLatestCode(
    email: string,
    code: string,
    purposes: CodePurpose[],
    at: Date,
  ): Promise<CodeRow | null> {
    if (!/^\d+$/.test(code) || code.length !== CODE_LENGTH) return null
    const [latest] = await store.codesSince(email, new Date(at.getTime() - OTP_RULES.ttlSec * 1000))
    if (
      !latest ||
      !purposes.includes(latest.purpose) ||
      latest.consumedAt ||
      latest.expiresAt <= at ||
      latest.attempts >= OTP_RULES.maxAttempts
    )
      return null
    if (!sameHash(latest.codeHash, hashCode(email, code))) {
      await store.addAttempt(latest.id)
      return null
    }
    return (await store.consumeCode(latest.id, at)) ? latest : null
  }

  async function verifyCode(input: { email: string; code: string }): Promise<VerifyResult> {
    const email = normalizeEmail(input.email)
    const at = now()
    const latest = await consumeLatestCode(email, input.code, ['login', 'register'], at)
    if (!latest) return { ok: false, error: 'invalid' }

    let record = await store.findCustomer(email)
    let created = false
    if (!record) {
      const id = randomUUID()
      record = await store.insertCustomer({
        id,
        email,
        name: latest.name,
        passwordHash: latest.passwordHash,
        createdAt: at,
      })
      // При гонке двух первых входов insertCustomer вернёт уже созданного — «создан» только у одного.
      created = record.id === id
    } else {
      if (!record.name && latest.name) {
        await store.setCustomerName(record.id, latest.name)
        record = { ...record, name: latest.name }
      }
      // Пароль из повторной регистрации не перезаписывает уже заданный.
      if (!record.passwordHash && latest.passwordHash)
        await store.setCustomerPassword(record.id, latest.passwordHash)
    }
    return openSession({ id: record.id, email: record.email, name: record.name }, at, created)
  }

  async function openSession(customer: Customer, at: Date, created = false): Promise<VerifyResult> {
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
    return { ok: true, customer, session: { token, expiresAt }, created }
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

  /** Задан ли пароль — для профиля (сам хеш наружу не отдаётся). */
  async function hasPassword(customerId: string) {
    return Boolean((await store.findCustomerById(customerId))?.passwordHash)
  }

  /** Код на почту покупателя для смены пароля без старого (те же лимиты отправки, что у входа). */
  async function requestPasswordCode(customerId: string): Promise<RequestResult | null> {
    const record = await store.findCustomerById(customerId)
    if (!record) return null
    return requestCode({ email: record.email, purpose: 'password' })
  }

  /**
   * Задать или сменить пароль в профиле (T-055). Нет пароля — достаточно сессии. Есть — нужен
   * текущий пароль или свежий код из письма (purpose `password`). После смены остальные сессии
   * отзываются: кто знал старый пароль, выходит; текущее устройство (`keepToken`) остаётся.
   */
  async function changePassword(input: {
    customerId: string
    next: string
    current?: string
    code?: string
    keepToken?: string
  }): Promise<PasswordChangeResult> {
    if (input.next.length < PASSWORD_MIN || input.next.length > PASSWORD_MAX)
      return { ok: false, error: 'weak' }
    const at = now()
    const record = await store.findCustomerById(input.customerId)
    if (!record) return { ok: false, error: 'unknown' }
    if (record.passwordHash) {
      if (input.current !== undefined) {
        if (!(await checkPassword(input.current, record.passwordHash)))
          return { ok: false, error: 'invalid_current' }
      } else if (input.code !== undefined) {
        if (!(await consumeLatestCode(record.email, input.code, ['password'], at)))
          return { ok: false, error: 'invalid_code' }
      } else return { ok: false, error: 'proof_required' }
    }
    await store.updateCustomerPassword(record.id, await hashPassword(input.next))
    const keep = input.keepToken && /^[\w-]{43}$/.test(input.keepToken) ? input.keepToken : null
    await store.revokeCustomerSessions(record.id, at, keep ? sha256(keep) : undefined)
    return { ok: true }
  }

  /** «Выйти на всех устройствах»: отозвать все сессии, включая текущую. */
  async function logoutEverywhere(customerId: string) {
    await store.revokeCustomerSessions(customerId, now())
  }

  return {
    requestCode,
    verifyCode,
    passwordLogin,
    getSession,
    logout,
    hasPassword,
    requestPasswordCode,
    changePassword,
    logoutEverywhere,
  }
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
    async findCustomerById(id) {
      const c = customers.find((x) => x.id === id)
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
    async updateCustomerPassword(id, passwordHash) {
      customers.find((x) => x.id === id)!.passwordHash = passwordHash
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
    async revokeCustomerSessions(customerId, at, exceptTokenHash) {
      for (const s of sessions)
        if (s.customerId === customerId && !s.revokedAt && s.tokenHash !== exceptTokenHash)
          s.revokedAt = at
    },
    dump: () => ({
      codes: codes.map((c) => ({ ...c })),
      sessions: sessions.map((s) => ({ ...s })),
      customers,
    }),
  }
}
