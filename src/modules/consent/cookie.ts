/**
 * Согласие на cookie (T-036, PRD WEB-06/WEB-07, design.md «Cookies и документы»). Чистые функции —
 * их используют и баннер в браузере, и тесты. Решение хранится в cookie первой стороны:
 * `<версия текста>.<a|n>.<время в секундах>` — без персональных данных. Смена версии текста
 * (новая политика) снова показывает баннер: старое согласие не переносится на новый документ.
 */

export const COOKIE_CONSENT_NAME = 'turdus_cookie_consent'

/** Версия текста баннера и документа «Использование cookie». Менять вместе с текстом. */
export const COOKIE_CONSENT_VERSION = 'draft-2026-10'

/** Срок хранения решения — полгода, затем спросим снова. */
export const COOKIE_CONSENT_MAX_AGE_SEC = 182 * 86_400

export type CookieConsent = {
  version: string
  /** Необязательная аналитика (Яндекс Метрика). Необходимые cookie (сессия кабинета) — всегда. */
  analytics: boolean
  at: Date
}

export const serializeCookieConsent = ({ version, analytics, at }: CookieConsent) =>
  `${version}.${analytics ? 'a' : 'n'}.${Math.floor(at.getTime() / 1000)}`

/** Разбор значения cookie; чужой формат, другая версия текста — как будто решения нет. */
export function parseCookieConsent(
  raw: string | null | undefined,
  version = COOKIE_CONSENT_VERSION,
): CookieConsent | null {
  const match = raw ? /^([\w-]{1,32})\.([an])\.(\d{1,12})$/.exec(raw) : null
  if (!match || match[1] !== version) return null
  return { version: match[1], analytics: match[2] === 'a', at: new Date(Number(match[3]) * 1000) }
}

/** Значение нужной cookie из строки `document.cookie`. */
export function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim())
      } catch {
        return null
      }
    }
  }
  return null
}

/** Строка для `document.cookie`. Secure — только на https (локально сайт открывают по http). */
export const cookieConsentHeader = (consent: CookieConsent, secure: boolean) =>
  [
    `${COOKIE_CONSENT_NAME}=${serializeCookieConsent(consent)}`,
    'Path=/',
    `Max-Age=${COOKIE_CONSENT_MAX_AGE_SEC}`,
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ')

/** Номер счётчика Метрики: только цифры, иначе счётчика нет. */
export const parseMetrikaId = (raw: string | undefined): string | null =>
  raw && /^\d{4,12}$/.test(raw.trim()) ? raw.trim() : null

/**
 * Можно ли загружать Метрику: счётчик настроен И зритель явно разрешил аналитику
 * в текущей версии текста. Нет решения → нет счётчика (WEB-07).
 */
export const mayLoadAnalytics = (consent: CookieConsent | null, counterId: string | null) =>
  Boolean(counterId && consent?.analytics)
