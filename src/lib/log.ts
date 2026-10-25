/**
 * Структурированный JSON-лог (T-015, rules.md §4, architecture.md §15). Одна строка — одно событие:
 * `{"ts","level","event",...поля}`. Без зависимостей: stdout контейнера собирает `docker compose logs`.
 *
 * Всё, что попадает в лог, проходит `redact`: секретные ключи (пароли, токены, коды, cookie, хеши)
 * заменяются целиком, почта и телефоны в любых строках маскируются, ошибки — только тип (сообщение
 * драйвера может содержать ПД или строку подключения). Логировать — безопасные идентификаторы
 * (id заказа, correlationId), а не данные покупателя.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/**
 * Стабильные коды сигналов: по ним строится оповещение (`grep '"alert":"ALERT_'`, docs/runbook.md).
 * Код не переименовывать — на него завязаны правила мониторинга.
 */
export const ALERTS = {
  /** Worker давно не писал heartbeat: задачи (сгорание, outbox) не выполняются. */
  workerStale: 'ALERT_WORKER_STALE',
  /** В outbox есть необработанные события старше порога. */
  outboxStuck: 'ALERT_OUTBOX_STUCK',
  /** Резервная копия не создана (scripts/backup.sh) или последняя успешная — слишком старая. */
  backupFailed: 'ALERT_BACKUP_FAILED',
  /** Фоновая задача упала (повторится на следующем такте). */
  jobFailed: 'ALERT_JOB_FAILED',
  /**
   * Платёж требует ручного разбора: оплата без остатка, неверная сумма/валюта, второй платёж
   * за заказ, нехватка бонусов при поздней оплате (`@/modules/orders`, purchase).
   */
  paymentReview: 'ALERT_PAYMENT_REVIEW',
} as const

export type AlertCode = (typeof ALERTS)[keyof typeof ALERTS]

export type LogFields = Record<string, unknown>

export type Logger = {
  debug: (event: string, fields?: LogFields) => void
  info: (event: string, fields?: LogFields) => void
  warn: (event: string, fields?: LogFields) => void
  error: (event: string, fields?: LogFields) => void
  /** Сигнал для оповещения: уровень error, `event: "alert"`, стабильный `alert`-код. */
  alert: (code: AlertCode, fields?: LogFields) => void
  /** Логгер с постоянными полями (correlationId, job, route). */
  child: (fields: LogFields) => Logger
}

const REDACTED = '[redacted]'

// Ключи, значение которых не логируется никогда (имя поля без `_`/`-`, без учёта регистра).
const SECRET_KEY =
  /pass(word)?|secret|token|authorization|cookie|otp|(auth|login|verification|sms)code$|codehash|^pin$|apikey|hash$|^session(id)?$|signature|credential|dsn|databaseurl|^card/i
// Ключи с ПД: значение маскируется целиком, даже если не похоже на почту/телефон.
const PERSONAL_KEY =
  /email|phone|^tel$|(full|first|last|middle|customer|buyer)name|address|^ip$|clientip/i
// Служебные идентификаторы: формат проверен при создании, маскировать нечего.
const SAFE_KEY = new Set(['correlationId', 'requestId', 'alert', 'event', 'level', 'ts'])
// Поле `code` — обычно машинный код ошибки (`invalid_input`); цифры в нём — вероятно, код входа.
const DIGIT_CODE = /^\s*\d{4,8}\s*$/

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu
// Российские и международные номера: +7 900 000-00-00, 8(900)0000000, +79000000000.
const PHONE = /(?<!\w)(\+?\d[\s()-]*){10,15}(?!\w)/g
const ISO_DATE = /\d{4}-\d{2}-\d{2}/
// Код из письма рядом со словом «код»/code/otp: «код 123456», "code: 1234".
const CODE_IN_TEXT = /((?:код|code|otp|pin)\D{0,12})\d{4,8}/giu
const BEARER = /\b(Bearer|Basic)\s+[\w.~+/=-]+/gi
// Пароль в строке подключения: postgres://user:pass@host → postgres://user:[redacted]@host.
const URL_PASSWORD = /([a-z][\w+.-]*:\/\/[^:/@\s]+:)[^@\s]+@/gi
// Длинные непрерывные hex/base64url-строки — вероятные токены и ключи.
const LONG_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const normalizeKey = (key: string) => key.replace(/[_-]/g, '')

/** Маскирует ПД и секреты внутри произвольной строки. */
export const redactString = (value: string): string =>
  value
    .replace(URL_PASSWORD, `$1${REDACTED}@`)
    .replace(BEARER, `$1 ${REDACTED}`)
    .replace(EMAIL, '[email]')
    .replace(CODE_IN_TEXT, `$1${REDACTED}`)
    // UUID (id заказа, correlationId) — не токен.
    .replace(LONG_TOKEN, (m) => (UUID.test(m) ? m : REDACTED))
    // Дата и время (2026-10-25 12:01:00+00) — не телефон.
    .replace(PHONE, (m) => (ISO_DATE.test(m) ? m : '[phone]'))

/** Ошибка в логе — только тип и машинный код (без message и stack: там бывают ПД и секреты). */
export const errorInfo = (error: unknown): { name: string; code?: string } => {
  if (!(error instanceof Error)) return { name: 'UnknownError' }
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code)
    ? { name: error.name, code }
    : { name: error.name }
}

const MAX_DEPTH = 6

/** Глубокая копия значения с маскированием секретов и ПД. */
export const redact = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'bigint') return value.toString()
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Error) return errorInfo(value)
  if (value instanceof Date) return value.toISOString()
  if (depth >= MAX_DEPTH) return '[depth]'
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const k = normalizeKey(key)
    if (SAFE_KEY.has(key) && typeof item === 'string' && /^[\w.:-]{1,128}$/.test(item))
      out[key] = item
    else if (SECRET_KEY.test(k)) out[key] = REDACTED
    else if (k.toLowerCase() === 'code' && typeof item === 'string' && DIGIT_CODE.test(item))
      out[key] = REDACTED
    else if (PERSONAL_KEY.test(k) && item != null && item !== '') out[key] = '[pii]'
    else out[key] = redact(item, depth + 1)
  }
  return out
}

export const parseLogLevel = (raw: string | undefined): LogLevel =>
  raw !== undefined && Object.hasOwn(LEVELS, raw) ? (raw as LogLevel) : 'info'

type LoggerOptions = {
  /** Минимальный уровень; по умолчанию LOG_LEVEL или info. */
  level?: LogLevel
  /** Постоянные поля каждой строки (service, correlationId). */
  base?: LogFields
  /** Куда писать строку (тесты подменяют). По умолчанию stdout, error — stderr. */
  write?: (line: string, level: LogLevel) => void
  now?: () => Date
}

const defaultWrite = (line: string, level: LogLevel) =>
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`)

export const createLogger = ({
  level = parseLogLevel(process.env.LOG_LEVEL),
  base = {},
  write = defaultWrite,
  now = () => new Date(),
}: LoggerOptions = {}): Logger => {
  const min = LEVELS[level]
  const emit = (lvl: LogLevel, event: string, fields?: LogFields) => {
    if (LEVELS[lvl] < min) return
    const record = {
      ts: now().toISOString(),
      level: lvl,
      event,
      ...(redact({ ...base, ...fields }) as LogFields),
    }
    try {
      write(JSON.stringify(record), lvl)
    } catch {
      // Лог не должен ронять запрос или задачу (например, закрытый stdout при остановке).
    }
  }
  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    alert: (code, fields) => emit('error', 'alert', { ...fields, alert: code }),
    child: (fields) => createLogger({ level, base: { ...base, ...fields }, write, now }),
  }
}

/** Логгер процесса по умолчанию (app). Worker создаёт свой с `service: "worker"`. */
export const log = createLogger({ base: { service: 'app' } })
