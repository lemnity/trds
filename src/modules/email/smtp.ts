import { createHash } from 'node:crypto'

import nodemailer from 'nodemailer'

import type { SmtpConfig } from './config'
import { EmailSendError, type EmailMessage, type EmailProvider } from './types'

/**
 * SMTP-адаптер `EmailProvider` (T-047). Подходит для NotiSend, Unisender Go и любого SMTP:
 * выбор сервиса театром меняет только переменные окружения. Таймауты соединения и ответа
 * обязательны (rules.md §6) — зависший сервер не держит worker. Повторы делает outbox,
 * не транспорт: здесь одна попытка и честная классификация ошибки.
 */

export const SMTP_TIMEOUTS = {
  connectionMs: 10_000,
  greetingMs: 10_000,
  socketMs: 30_000,
} as const

// Сетевые сбои и таймауты — временные: письмо подождёт и уйдёт следующей попыткой.
const PERMANENT_CODES = new Set(['EENVELOPE', 'EMESSAGE'])

/** Классификация ошибки nodemailer: 5xx и отказ в конверте — постоянные, остальное — временное. */
export const classifySmtpError = (error: unknown): EmailSendError => {
  const e = (error ?? {}) as { code?: unknown; responseCode?: unknown }
  const responseCode = typeof e.responseCode === 'number' ? e.responseCode : null
  const code = typeof e.code === 'string' && /^[A-Z0-9_]{1,24}$/.test(e.code) ? e.code : null
  if (responseCode !== null)
    return new EmailSendError(
      `SMTP_${responseCode}`,
      responseCode >= 500 && responseCode < 600 && code !== 'EAUTH',
    )
  return new EmailSendError(code ?? 'SMTP_UNKNOWN', code !== null && PERMANENT_CODES.has(code))
}

const domainOf = (from: string) => /@([^\s>]+)/.exec(from)?.[1] ?? 'turdus.local'

/** Message-ID из ключа идемпотентности: повтор после сбоя — то же письмо для почтовых систем. */
export const messageIdFor = (key: string, from: string) =>
  `<${createHash('sha256').update(key).digest('hex').slice(0, 32)}@${domainOf(from)}>`

type Transport = { sendMail: (options: Record<string, unknown>) => Promise<unknown> }

export function createSmtpProvider(
  config: SmtpConfig,
  transport: Transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    auth: config.user ? { user: config.user, pass: config.password ?? '' } : undefined,
    connectionTimeout: SMTP_TIMEOUTS.connectionMs,
    greetingTimeout: SMTP_TIMEOUTS.greetingMs,
    socketTimeout: SMTP_TIMEOUTS.socketMs,
    // Логи транспорта выключены: в них адреса и содержимое писем.
    logger: false,
    debug: false,
  }) as unknown as Transport,
): EmailProvider {
  return {
    async send(message: EmailMessage) {
      try {
        await transport.sendMail({
          from: config.from,
          to: message.to,
          ...(config.replyTo && { replyTo: config.replyTo }),
          subject: message.subject,
          text: message.text,
          ...(message.html && { html: message.html }),
          ...(message.attachments && {
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              contentType: a.contentType,
              ...(a.cid && { cid: a.cid, contentDisposition: 'inline' }),
            })),
          }),
          ...(message.idempotencyKey && {
            messageId: messageIdFor(message.idempotencyKey, config.from),
          }),
        })
      } catch (error) {
        throw classifySmtpError(error)
      }
    },
  }
}
