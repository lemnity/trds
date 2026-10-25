import { randomBytes, randomInt } from 'node:crypto'

import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test'

import {
  COOKIE_CONSENT_NAME,
  COOKIE_CONSENT_VERSION,
  serializeCookieConsent,
} from '../../../src/modules/consent/cookie'
import { baseUrl } from './env'

/**
 * Общие фикстуры e2e:
 * - `baseURL` — адрес сервера из global-setup (конфиг читается раньше, чем он известен);
 * - у каждого теста свой `X-Forwarded-For`: лимиты по IP (вход, checkout, заявки) общие на базу,
 *   и тесты не должны съедать попытки друг друга (за Caddy адрес клиента берётся из этого
 *   заголовка, так что это и есть «разные зрители»);
 * - баннер cookie по умолчанию уже решён («только необходимые»): он не перекрывает формы.
 *   Сам баннер проверяет cookie-consent.spec.ts с `consent: 'none'`.
 */

type Options = { consent: 'none' | 'necessary' }

export const randomIp = () => `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`

// Колбэк фикстуры назван `provide`, а не `use`: правило React-хуков в ESLint принимает `use(…)`
// за хук React.
export const test = base.extend<Options>({
  consent: ['necessary', { option: true }],
  baseURL: async ({}, provide) => provide(baseUrl()),
  extraHTTPHeaders: async ({}, provide) => provide({ 'x-forwarded-for': randomIp() }),
  context: async ({ context, consent }, provide) => {
    if (consent === 'necessary') {
      // Формат и версия — из модуля согласий сайта, как пишет баннер.
      const value = serializeCookieConsent({
        version: COOKIE_CONSENT_VERSION,
        analytics: false,
        at: new Date(),
      })
      await context.addCookies([
        { name: COOKIE_CONSENT_NAME, value, url: baseUrl(), sameSite: 'Lax' },
      ])
    }
    await provide(context)
  },
})

export { expect }

/** Уникальная почта зрителя на тест (домен example.com зарезервирован, писем никто не получит). */
export const uniqueEmail = (prefix: string) =>
  `e2e-${prefix}-${randomBytes(4).toString('hex')}@example.com`

/**
 * Изменяющие запросы API проверяют Origin (CSRF) — шлём как браузер со своего сайта. Тип тела
 * Playwright ставит сам (`data` — JSON, `form` — urlencoded).
 */
export const apiHeaders = () => ({ origin: baseUrl() })

/** Последний код из локального почтового ящика dev-сервера (`/api/dev/outbox`) для этой почты. */
export async function readCode(
  request: APIRequestContext,
  email: string,
  after: Date,
): Promise<string> {
  let code: string | null = null
  await expect
    .poll(
      async () => {
        // Сокет keep-alive, закрытый сервером после простоя (ECONNRESET), — повтор на следующем шаге.
        const res = await request.get('/api/dev/outbox').catch(() => null)
        if (!res?.ok()) return null
        const mails = (await res.json()) as { to: string; text: string; sentAt: string }[]
        const mail = mails.find((m) => m.to === email && Date.parse(m.sentAt) >= after.getTime())
        code = mail?.text.match(/\b(\d{6})\b/)?.[1] ?? null
        return code
      },
      { message: `письмо с кодом для ${email}`, timeout: 20_000 },
    )
    .not.toBeNull()
  return code!
}

/**
 * Быстрый вход через API (для сценариев, где сам вход не проверяется): регистрация кодом из
 * письма; cookie сессии попадает в контекст страницы.
 */
export async function signUpViaApi(
  who: Page | APIRequestContext,
  email: string,
  name = 'Зритель E2E',
) {
  const request = 'request' in who ? who.request : who
  const since = new Date(Date.now() - 1000)
  const sent = await request.post('/api/auth/email-code/request', {
    headers: apiHeaders(),
    data: { purpose: 'register', email, name, password: 'e2e-password-123', consent: true },
  })
  expect(sent.status(), await sent.text()).toBe(200)
  const code = await readCode(request, email, since)
  const verified = await request.post('/api/auth/email-code/verify', {
    headers: apiHeaders(),
    data: { email, code },
  })
  expect(verified.status(), await verified.text()).toBe(200)
}

/** Номер сертификата из выпущенных global-setup: у каждого теста — свой (по индексу). */
export { readCertificate } from './certificates'
