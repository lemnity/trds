/**
 * Настройка почты из окружения (T-047, .env.example). Значения секретов не логируются и не
 * попадают в клиент: модуль только серверный.
 *
 * EMAIL_PROVIDER=smtp:
 *   SMTP_HOST, SMTP_PORT (по умолчанию 587), SMTP_SECURE (true — TLS сразу, порт 465;
 *   иначе STARTTLS обязателен, кроме localhost), SMTP_USER, SMTP_PASSWORD, EMAIL_FROM,
 *   EMAIL_REPLY_TO (необязательно).
 * EMAIL_PROVIDER=dev — локальный ящик /api/dev/outbox (только разработка); без переменной в
 * разработке — тоже он. Иначе — 'none': отправка недоступна.
 */

export type SmtpConfig = {
  provider: 'smtp'
  host: string
  port: number
  secure: boolean
  /** STARTTLS обязателен (не отправлять открытым текстом), кроме локального сервера. */
  requireTls: boolean
  user: string | null
  password: string | null
  from: string
  replyTo: string | null
}

export type EmailConfig =
  | SmtpConfig
  | { provider: 'dev' }
  /** `missing` — каких переменных не хватает (имена, без значений). */
  | { provider: 'none'; missing: string[] }

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|::1|mailpit|mailhog)$/i

export function emailConfigFromEnv(
  env: Record<string, string | undefined>,
  { dev }: { dev: boolean },
): EmailConfig {
  const provider = env.EMAIL_PROVIDER?.trim().toLowerCase()
  if (provider === 'smtp') {
    const host = env.SMTP_HOST?.trim() ?? ''
    const from = env.EMAIL_FROM?.trim() ?? ''
    const port = Number(env.SMTP_PORT ?? 587)
    const missing = [
      ...(host ? [] : ['SMTP_HOST']),
      ...(from ? [] : ['EMAIL_FROM']),
      ...(Number.isInteger(port) && port > 0 && port < 65536 ? [] : ['SMTP_PORT']),
    ]
    const user = env.SMTP_USER?.trim() || null
    const password = env.SMTP_PASSWORD || null
    if (user && !password) missing.push('SMTP_PASSWORD')
    if (missing.length) return { provider: 'none', missing }
    const secure = env.SMTP_SECURE === 'true' || (env.SMTP_SECURE === undefined && port === 465)
    return {
      provider: 'smtp',
      host,
      port,
      secure,
      requireTls: !secure && !LOCAL_HOST.test(host),
      user,
      password,
      from,
      replyTo: env.EMAIL_REPLY_TO?.trim() || null,
    }
  }
  if (provider === 'dev' || (!provider && dev)) return dev ? { provider: 'dev' } : none()
  return none(provider ? [] : ['EMAIL_PROVIDER'])
}

const none = (missing: string[] = ['EMAIL_PROVIDER']): EmailConfig => ({
  provider: 'none',
  missing,
})

export const isEmailConfigured = (config: EmailConfig) => config.provider !== 'none'

/** Публичный адрес сайта для ссылок в письмах (без завершающего «/»). */
export const siteUrlFromEnv = (env: Record<string, string | undefined>) =>
  (env.PUBLIC_SITE_URL || env.NEXT_PUBLIC_SITE_URL || 'https://teatrturdus.ru').replace(/\/+$/, '')
