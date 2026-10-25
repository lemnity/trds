import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * TOTP (RFC 6238) поверх HOTP (RFC 4226) на node:crypto — без сторонней библиотеки: алгоритм
 * короткий и проверяется тестовыми векторами RFC (tests/unit/cms-mfa.test.ts). Параметры —
 * те, что понимают все приложения-аутентификаторы: SHA-1, 6 цифр, шаг 30 секунд.
 */
export const TOTP_PERIOD_SECONDS = 30
export const TOTP_DIGITS = 6
/** Допуск расхождения часов: ±1 шаг (±30 с). */
export const TOTP_WINDOW = 1

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export const base32Encode = (bytes: Uint8Array): string => {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export const base32Decode = (input: string): Buffer => {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const index = BASE32.indexOf(ch)
    if (index < 0) throw new RangeError('invalid base32')
    value = ((value << 5) | index) & 0xffff
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** Новый секрет: 20 байт (160 бит), как рекомендует RFC 4226 для SHA-1. */
export const generateTotpSecret = (): string => base32Encode(randomBytes(20))

export const hotp = (secret: Buffer, counter: number, digits = TOTP_DIGITS): string => {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', secret).update(message).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const binary = digest.readUInt32BE(offset) & 0x7fffffff
  return String(binary % 10 ** digits).padStart(digits, '0')
}

export const totpStep = (at: Date) => Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS)

export const totpAt = (secretBase32: string, at: Date) =>
  hotp(base32Decode(secretBase32), totpStep(at))

const sameCode = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * Шаг, которому соответствует код (в окне ±TOTP_WINDOW), или null. Повтор кода отсекает
 * вызывающий: шаг должен быть строго больше последнего принятого.
 */
export const matchTotp = (secretBase32: string, code: string, at: Date): number | null => {
  const normalized = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(normalized)) return null
  const secret = base32Decode(secretBase32)
  const current = totpStep(at)
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
    const step = current + delta
    if (step >= 0 && sameCode(hotp(secret, step), normalized)) return step
  }
  return null
}

/** Ссылка для приложения-аутентификатора (Google Authenticator, Яндекс Ключ, 1Password…). */
export const otpauthUrl = ({
  issuer,
  account,
  secret,
}: {
  issuer: string
  account: string
  secret: string
}) => {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
