/**
 * Номер подарочного сертификата (PRD §5.8): `TRDS-XXXX-XXXX-XXXX` — 11 случайных символов
 * и 1 контрольный (Luhn mod N). Алфавит без похожих знаков (нет 0/O, 1/I/L, U): 30 символов,
 * ≈ 54 бита случайности — перебором не подобрать при лимите попыток.
 *
 * Модуль без node:crypto, чтобы проверку формата можно было выполнять и в браузере;
 * источник случайности передаёт сервер (crypto.randomInt).
 */
export const CERTIFICATE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
export const CERTIFICATE_PREFIX = 'TRDS'

const N = CERTIFICATE_ALPHABET.length
const RANDOM_LENGTH = 11

/** Контрольный символ Luhn mod N: ловит любую одиночную ошибку и почти все перестановки соседей. */
const checkCharFor = (body: string) => {
  let factor = 2
  let sum = 0
  for (let i = body.length - 1; i >= 0; i--) {
    const index = CERTIFICATE_ALPHABET.indexOf(body[i] ?? '')
    let addend = factor * index
    factor = factor === 2 ? 1 : 2
    addend = Math.floor(addend / N) + (addend % N)
    sum += addend
  }
  return CERTIFICATE_ALPHABET[(N - (sum % N)) % N] as string
}

const group = (code: string) =>
  `${CERTIFICATE_PREFIX}-${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`

/** Новый номер. `randomInt(max)` — криптографический генератор целых в [0, max). */
export const generateCertificateCode = (randomInt: (max: number) => number) => {
  let body = ''
  for (let i = 0; i < RANDOM_LENGTH; i++) body += CERTIFICATE_ALPHABET[randomInt(N)]
  return group(body + checkCharFor(body))
}

export type ParsedCertificate =
  { ok: true; code: string; canonical: string } | { ok: false; error: 'FORMAT' | 'CHECKSUM' }

/**
 * Разбор ввода: регистр, пробелы и дефисы не важны, префикс TRDS необязателен.
 * `canonical` — 12 символов без префикса (по нему считается хеш), `code` — для показа.
 */
export const parseCertificateCode = (input: string): ParsedCertificate => {
  let raw = input.toUpperCase().replace(/[\s-]/g, '')
  if (raw.startsWith(CERTIFICATE_PREFIX) && raw.length === CERTIFICATE_PREFIX.length + 12)
    raw = raw.slice(CERTIFICATE_PREFIX.length)
  if (raw.length !== RANDOM_LENGTH + 1 || [...raw].some((c) => !CERTIFICATE_ALPHABET.includes(c)))
    return { ok: false, error: 'FORMAT' }
  if (checkCharFor(raw.slice(0, RANDOM_LENGTH)) !== raw.slice(RANDOM_LENGTH))
    return { ok: false, error: 'CHECKSUM' }
  return { ok: true, code: group(raw), canonical: raw }
}

/** Последние 4 символа — единственное, что показывается после выпуска. */
export const certificateLast4 = (canonical: string) => canonical.slice(-4)

/** Открытый порядковый номер для учёта и печати: С-000123. */
export const certificateSerial = (n: number) => `С-${String(n).padStart(6, '0')}`
