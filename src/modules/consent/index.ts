// Публичный вход модуля согласий. Только чистые функции и константы — безопасно для браузера.
export {
  COOKIE_CONSENT_MAX_AGE_SEC,
  COOKIE_CONSENT_NAME,
  COOKIE_CONSENT_VERSION,
  cookieConsentHeader,
  mayLoadAnalytics,
  parseCookieConsent,
  parseMetrikaId,
  readCookie,
  serializeCookieConsent,
  type CookieConsent,
} from './cookie'
export {
  CONSENT_DOCUMENTS,
  type ConsentContext,
  type ConsentDocument,
  type ConsentRecord,
} from './documents'
