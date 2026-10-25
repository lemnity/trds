/** Контракт отправки писем (T-047): сообщение, провайдер, ошибки. Без зависимостей. */

export type EmailAttachment = {
  filename: string
  content: Buffer
  contentType: string
  /** Для картинок внутри письма: `<img src="cid:…">`. */
  cid?: string
}

export type EmailMessage = {
  to: string
  subject: string
  text: string
  html?: string
  attachments?: EmailAttachment[]
  /**
   * Стабильный ключ письма (dedupe key outbox): из него строится Message-ID, чтобы повторная
   * отправка после сбоя была тем же письмом, а не новым.
   */
  idempotencyKey?: string
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('Email provider is not configured')
    this.name = 'EmailNotConfiguredError'
  }
}

/**
 * Ошибка отправки. `permanent` — повтор бессмысленен (адрес не существует, письмо отклонено 5xx);
 * иначе — временная (сеть, таймаут, 4xx), outbox повторит с backoff. `code` — машинный, без ПД.
 */
export class EmailSendError extends Error {
  constructor(
    readonly code: string,
    readonly permanent: boolean,
  ) {
    super(`Email send failed: ${code}`)
    this.name = 'EmailSendError'
  }
}
