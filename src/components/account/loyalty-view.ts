import { formatRub } from '@/lib/money'
import { CERTIFICATE_ALPHABET, LOYALTY_RULES, parseCertificateCode } from '@/modules/loyalty'

/**
 * Бонусы в кабинете: типы ответа `/api/loyalty/summary` и чистые помощники вывода
 * (подписи, суммы, даты, маска номера сертификата, тексты ошибок). Без React — покрыто тестами.
 */
export type LoyaltyKind = 'purchase' | 'referral' | 'certificate' | 'spend' | 'expire' | 'manual'

export type LoyaltyHistoryEntry = {
  id: string
  kind: LoyaltyKind
  /** Со знаком: начисление > 0, списание и сгорание < 0. */
  amountKopecks: number
  at: string
  expiresAt: string | null
}

export type LoyaltyCertificate = {
  serial: string
  last4: string
  amountKopecks: number
  activatedAt: string
  expiresAt: string
}

export type LoyaltySummary = {
  balanceKopecks: number
  expiring: { amountKopecks: number; earliest: string } | null
  history: LoyaltyHistoryEntry[]
  referral: {
    code: string
    link: string
    qualified: number
    progress: { inRound: number; remaining: number; rewards: number; groupSize: number }
  }
  certificates: LoyaltyCertificate[]
}

export const HISTORY_LABELS: Record<LoyaltyKind, string> = {
  purchase: 'Покупка',
  referral: 'Приведи друзей',
  certificate: 'Сертификат',
  spend: 'Оплата заказа',
  expire: 'Сгорели',
  manual: 'Корректировка',
}

export const historyLabel = (kind: string) => HISTORY_LABELS[kind as LoyaltyKind] ?? 'Операция'

/** «+120 ₽» / «−60 ₽» (настоящий минус, U+2212). */
export const formatSignedRub = (kopecks: number) =>
  kopecks > 0 ? `+${formatRub(kopecks)}` : kopecks < 0 ? `−${formatRub(-kopecks)}` : formatRub(0)

// Даты — по часовому поясу театра (THEATRE_TIME_ZONE в @/modules/shows; модуль серверный).
const TIME_ZONE = 'Asia/Yekaterinburg'
const dayMonthYear = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
const dayMonth = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
})

/** 25.10.2027; пустая строка для неразборчивой даты. */
export const formatDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : dayMonthYear.format(d)
}

/** 25.10 — для строки «сгорят». */
export const formatDayMonth = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : dayMonth.format(d)
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** Срок жизни начисления: 365 дней → «1 год», иначе дни. */
export const lifetimeText = (days: number) => {
  if (days > 0 && days % 365 === 0) {
    const years = days / 365
    return `${years} ${plural(years, 'год', 'года', 'лет')}`
  }
  return `${days} ${plural(days, 'день', 'дня', 'дней')}`
}

/** «3% за покупки · до 30% стоимости билета · срок 1 год» — из действующих настроек. */
export const rulesLine = (settings = LOYALTY_RULES) =>
  [
    `${settings.accrualBasisPoints / 100}% за покупки`,
    `до ${settings.maxSpendBasisPoints / 100}% стоимости билета`,
    `срок ${lifetimeText(settings.bonusLifetimeDays)}`,
  ].join(' · ')

/** Подпись индикатора «Приведи 3 друга» (основная строка; «Уже начислено…» — отдельно). */
export const referralCaption = (
  progress: { inRound: number; remaining: number; rewards: number },
  remainingText: (remaining: number) => string,
  settings = LOYALTY_RULES,
) => {
  if (progress.inRound > 0) return remainingText(progress.remaining)
  const reward = formatRub(settings.referralRewardKopecks)
  return progress.rewards > 0
    ? `Пригласите ещё трёх друзей — получите ещё ${reward} бонусами`
    : `Пригласите трёх друзей — получите ${reward} бонусами`
}

// --- Номер сертификата ---

/** Кириллица, похожая на латиницу (ввод в русской раскладке): С → C, Т → T и т. д. */
const LOOKALIKES: Record<string, string> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
}

const PREFIX = 'TRDS'
const CODE_LENGTH = 12

/**
 * Маска поля: заглавные, только буквы и цифры, дефисы между группами по 4.
 * Хвостовой дефис не ставим — иначе Backspace «застревает» на нём.
 */
export const formatCertificateInput = (raw: string) => {
  const chars = [...raw.toUpperCase()]
    .map((c) => LOOKALIKES[c] ?? c)
    .filter((c) => /[A-Z0-9]/.test(c))
    .join('')
    .slice(0, PREFIX.length + CODE_LENGTH)
  return chars.match(/.{1,4}/g)?.join('-') ?? ''
}

/** Символы номера без префикса TRDS (если он набран целиком). */
const codeBody = (value: string) => {
  const raw = value.toUpperCase().replace(/[\s-]/g, '')
  return raw.startsWith(PREFIX) && raw.length > CODE_LENGTH ? raw.slice(PREFIX.length) : raw
}

export const CERTIFICATE_ERRORS = {
  empty: 'Введите номер сертификата',
  incomplete: 'Номер — TRDS и ещё 12 символов: TRDS-XXXX-XXXX-XXXX',
  symbols: 'В номере не бывает 0, 1, O, I, L и U — проверьте символы',
  checksum: 'Похоже, в номере опечатка — проверьте символы',
  notAvailable: 'Сертификат не найден или уже активирован',
  rateLimited: 'Слишком много попыток, попробуйте через 15 минут',
  unauthorized: 'Сессия закончилась — войдите снова',
  unavailable: 'Не получилось связаться с сервером. Попробуйте ещё раз через пару минут',
} as const

/**
 * Проверка в браузере. `final` — при отправке/уходе с поля: тогда ругаемся и на неполный номер;
 * при наборе — только на то, что точно ошибка (чужой символ, опечатка в полном номере).
 */
export const certificateInputError = (value: string, final = false): string | null => {
  const body = codeBody(value)
  if (!body) return final ? CERTIFICATE_ERRORS.empty : null
  if ([...body].some((c) => !CERTIFICATE_ALPHABET.includes(c))) return CERTIFICATE_ERRORS.symbols
  const parsed = parseCertificateCode(value)
  if (parsed.ok) return null
  if (parsed.error === 'CHECKSUM') return CERTIFICATE_ERRORS.checksum
  return final ? CERTIFICATE_ERRORS.incomplete : null
}

/** Ответ сервера на активацию → текст для пользователя. */
export const activationErrorText = (status: number, error?: string | null) => {
  if (error === 'invalid_format') return CERTIFICATE_ERRORS.incomplete
  if (error === 'checksum') return CERTIFICATE_ERRORS.checksum
  if (status === 422 || error === 'not_available') return CERTIFICATE_ERRORS.notAvailable
  if (status === 429 || error === 'rate_limited') return CERTIFICATE_ERRORS.rateLimited
  if (status === 401) return CERTIFICATE_ERRORS.unauthorized
  return CERTIFICATE_ERRORS.unavailable
}

/** «На баланс зачислено 1 000 ₽ · действуют до 25.10.2027». */
export const activationSuccessText = (amountKopecks: number, expiresAt: string) =>
  `На баланс зачислено ${formatRub(amountKopecks)} · действуют до ${formatDate(expiresAt)}`
