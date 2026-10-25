import { emailConfigFromEnv, type EmailConfig } from './config'
import { createSmtpProvider } from './smtp'
import { EmailNotConfiguredError, type EmailMessage, type EmailProvider } from './types'

/**
 * Отправка писем через интерфейс `EmailProvider` (architecture.md: NotiSend / Unisender Go —
 * выбор после проверки условий, T-047). Адаптер — универсальный SMTP (оба сервиса его дают),
 * настраивается переменными окружения (`config.ts`):
 * - `EMAIL_PROVIDER=smtp` — SMTP-сервер провайдера (`smtp.ts`, таймауты, классификация ошибок);
 * - в разработке без настройки письма складываются в локальный ящик (`devOutbox`, /api/dev/outbox);
 * - в production без настройки отправка недоступна — вызывающий показывает понятную ошибку,
 *   а письма из outbox ждут в очереди (worker не запускает отправку).
 * Тело письма (в нём может быть код входа или ссылка на билет) не логируется.
 */

export {
  EmailNotConfiguredError,
  EmailSendError,
  type EmailAttachment,
  type EmailMessage,
  type EmailProvider,
} from './types'

type Stored = Omit<EmailMessage, 'attachments'> & {
  attachments?: { filename: string; contentType: string; size: number }[]
  sentAt: string
}

const OUTBOX_LIMIT = 50
const globalOutbox = globalThis as typeof globalThis & { __turdusOutbox?: Stored[] }

/** Локальный ящик разработки: последние письма в памяти процесса (вложения — только описание). */
export const devOutbox = {
  list: (): Stored[] => [...(globalOutbox.__turdusOutbox ?? [])].reverse(),
  push({ attachments, ...message }: EmailMessage) {
    const box = (globalOutbox.__turdusOutbox ??= [])
    box.push({
      ...message,
      ...(attachments && {
        attachments: attachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.content.length,
        })),
      }),
      sentAt: new Date().toISOString(),
    })
    if (box.length > OUTBOX_LIMIT) box.splice(0, box.length - OUTBOX_LIMIT)
  },
}

export const isDevEmail = () => process.env.NODE_ENV === 'development'

/** Провайдер по уже разобранной настройке (worker передаёт свою, тесты — свою). */
export function createEmailProvider(config: EmailConfig): EmailProvider {
  if (config.provider === 'smtp') return createSmtpProvider(config)
  if (config.provider === 'dev') return { send: async (m) => devOutbox.push(m) }
  return {
    send: async () => {
      throw new EmailNotConfiguredError()
    },
  }
}

let cached: { key: string; provider: EmailProvider } | undefined

export function getEmailProvider(): EmailProvider {
  const config = emailConfigFromEnv(process.env, { dev: isDevEmail() })
  // Один транспорт на процесс; новая настройка (тесты, перезапуск) — новый транспорт.
  const key = JSON.stringify(config)
  if (cached?.key !== key) cached = { key, provider: createEmailProvider(config) }
  return cached.provider
}

export {
  emailConfigFromEnv,
  isEmailConfigured,
  siteUrlFromEnv,
  type EmailConfig,
  type SmtpConfig,
} from './config'
export {
  needsReviewEmail,
  refundEmail,
  ticketsEmail,
  type NeedsReviewEmailInput,
  type RefundEmailInput,
  type TicketsEmailInput,
} from './templates'
export { leadCreatedEmail, type LeadCreatedEmailInput } from './leadTemplates'
export {
  OUTBOX_RULES,
  PermanentOutboxError,
  backoffMs,
  createOutboxProcessor,
  type OutboxHandler,
  type OutboxItem,
  type OutboxProcessor,
  type OutboxQueue,
  type OutboxRunStats,
} from './outbox'

/** Письмо с кодом входа, подтверждения почты или смены пароля. */
export const codeEmail = (
  code: string,
  purpose: 'login' | 'register' | 'password',
): Omit<EmailMessage, 'to'> => ({
  subject: {
    register: `${code} — код подтверждения почты TURDUS`,
    login: `${code} — код входа TURDUS`,
    password: `${code} — код для смены пароля TURDUS`,
  }[purpose],
  text: [
    {
      register: 'Подтвердите почту для личного кабинета модного театра TURDUS.',
      login: 'Вход в личный кабинет модного театра TURDUS.',
      password: 'Смена пароля в личном кабинете модного театра TURDUS.',
    }[purpose],
    '',
    `Код: ${code}`,
    '',
    'Код действует 10 минут. Если вы не запрашивали его, просто проигнорируйте письмо.',
  ].join('\n'),
})
