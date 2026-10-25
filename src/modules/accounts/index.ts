import config from '@payload-config'
import { createHmac, randomUUID } from 'node:crypto'
import { getPayload } from 'payload'

import { CONSENT_DOCUMENTS } from '@/modules/consent'
import { codeEmail, getEmailProvider } from '@/modules/email'

import { pgAuthStore, recordConsent } from './pgStore'
import { createAuthService, memoryAuthStore, type AuthService } from './service'

export {
  OTP_RULES,
  PASSWORD_MAX,
  type Customer,
  type PasswordChangeResult,
  type RequestResult,
  type VerifyResult,
} from './service'
export { EmailNotConfiguredError } from '@/modules/email'

/** Имя cookie сессии кабинета (HttpOnly). */
export const SESSION_COOKIE = 'turdus_session'

/** Версия документа «Согласие на обработку ПД», под которой даётся согласие. */
export const CONSENT_VERSION = CONSENT_DOCUMENTS['personal-data'].version

const memoryStore = globalThis as typeof globalThis & {
  __turdusAccounts?: ReturnType<typeof memoryAuthStore>
}

let service:
  | Promise<{ auth: AuthService; consent: (email: string, context: string) => Promise<void> }>
  | undefined

/**
 * Сервис входа и сессий на PostgreSQL (соединение Payload). Секрет кодов выводится из
 * PAYLOAD_SECRET отдельной меткой — отдельная переменная не нужна, секрет не уходит в клиент.
 */
export function getAccounts() {
  service ??= (async () => {
    // Разработка без базы: ACCOUNTS_STORE=memory — коды и сессии в памяти процесса.
    // В production не работает: там только PostgreSQL.
    if (process.env.NODE_ENV !== 'production' && process.env.ACCOUNTS_STORE === 'memory') {
      const email = getEmailProvider()
      const auth = createAuthService({
        // Один экземпляр на процесс: API-маршруты и страницы Next собирает отдельными модулями.
        store: (memoryStore.__turdusAccounts ??= memoryAuthStore()),
        secret: createHmac('sha256', process.env.PAYLOAD_SECRET || 'dev')
          .update('turdus:otp')
          .digest('hex'),
        sendCode: async ({ email: to, code, purpose }) =>
          email.send({ to, ...codeEmail(code, purpose) }),
      })
      return { auth, consent: async () => undefined }
    }
    const payload = await getPayload({ config })
    const db = payload.db.drizzle as unknown as Parameters<typeof pgAuthStore>[0]
    const secret = createHmac('sha256', process.env.PAYLOAD_SECRET ?? '')
      .update('turdus:otp')
      .digest('hex')
    const email = getEmailProvider()
    const auth = createAuthService({
      store: pgAuthStore(db),
      secret,
      sendCode: async ({ email: to, code, purpose }) =>
        email.send({ to, ...codeEmail(code, purpose) }),
    })
    const consent = (to: string, context: string) =>
      recordConsent(db, {
        id: randomUUID(),
        email: to.trim().toLowerCase(),
        document: 'personal-data',
        version: CONSENT_VERSION,
        context,
        givenAt: new Date(),
      })
    return { auth, consent }
  })()
  // Не запоминаем неудачу (база была недоступна) — следующий запрос попробует снова.
  service.catch(() => {
    service = undefined
  })
  return service
}
