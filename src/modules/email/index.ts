/**
 * Отправка писем через интерфейс `EmailProvider` (architecture.md: NotiSend / Unisender Go —
 * выбор после проверки условий, T-047). Пока провайдер не подключён:
 * - в разработке письма складываются в локальный ящик (`devOutbox`, страница /api/dev/outbox);
 * - в production отправка недоступна — вызывающий показывает понятную ошибку.
 * Тело письма (в нём может быть код входа) не логируется.
 */

export type EmailMessage = { to: string; subject: string; text: string }

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('Email provider is not configured')
  }
}

type Stored = EmailMessage & { sentAt: string }

const OUTBOX_LIMIT = 50
const globalOutbox = globalThis as typeof globalThis & { __turdusOutbox?: Stored[] }

/** Локальный ящик разработки: последние письма в памяти процесса. */
export const devOutbox = {
  list: (): Stored[] => [...(globalOutbox.__turdusOutbox ?? [])].reverse(),
  push(message: EmailMessage) {
    const box = (globalOutbox.__turdusOutbox ??= [])
    box.push({ ...message, sentAt: new Date().toISOString() })
    if (box.length > OUTBOX_LIMIT) box.splice(0, box.length - OUTBOX_LIMIT)
  },
}

export const isDevEmail = () => process.env.NODE_ENV === 'development'

export function getEmailProvider(): EmailProvider {
  if (isDevEmail()) return { send: async (m) => devOutbox.push(m) }
  return {
    send: async () => {
      throw new EmailNotConfiguredError()
    },
  }
}

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
