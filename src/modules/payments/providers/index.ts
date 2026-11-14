import { createHmac } from 'node:crypto'

import type { PaymentProvider } from '../types'
import {
  FAKE_PROVIDER_ID,
  createFakeProvider,
  fakeBankState,
  type FakeBank,
  type FakeBankState,
} from './fake'
import { TBANK_DEFAULT_API_URL, TBANK_PROVIDER_ID, createTbankProvider } from './tbank'

/**
 * Выбор провайдера по `PAYMENT_PROVIDER` (T-043). Пусто — оплата не подключена: checkout честно
 * говорит об этом (так остаётся на превью и в production, пока нет адаптера банка, T-001).
 * `fake` — учебный банк, только вне production. Неизвестное значение — ошибка конфигурации:
 * лучше отказать в оплате, чем молча принять деньги не тем адаптером.
 */

export type ProviderSelection = {
  provider: PaymentProvider
  /** Управление учебным банком (страница dev); у настоящего банка — null. */
  fakeBank: FakeBank | null
  /**
   * Деньги ненастоящие: учебный банк или тестовый терминал Т-Банка (ключ оканчивается на DEMO).
   * Только тогда можно продавать по ценам/сбору, ещё не утверждённым театром (проверка оплаты).
   */
  testMode: boolean
}

export class PaymentConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentConfigError'
  }
}

const memory = globalThis as typeof globalThis & { __turdusFakeBank?: FakeBankState }

type Env = Record<string, string | undefined>

/** null — оплата на сайте не подключена. */
export function selectPaymentProvider(env: Env = process.env): ProviderSelection | null {
  const id = env.PAYMENT_PROVIDER?.trim()
  if (!id) return null
  if (id === FAKE_PROVIDER_ID) {
    if (env.NODE_ENV === 'production')
      throw new PaymentConfigError('PAYMENT_PROVIDER=fake is not allowed in production')
    const secret = createHmac('sha256', env.PAYLOAD_SECRET || 'dev')
      .update('turdus:fake-bank')
      .digest('hex')
    // Один банк на процесс: маршруты Next собираются отдельными модулями.
    const { provider, bank } = createFakeProvider({
      secret,
      state: (memory.__turdusFakeBank ??= fakeBankState()),
    })
    return { provider, fakeBank: bank, testMode: true }
  }
  if (id === TBANK_PROVIDER_ID) {
    const terminalKey = env.TBANK_TERMINAL_KEY?.trim()
    const password = env.TBANK_PASSWORD?.trim()
    const site = (env.PUBLIC_SITE_URL || env.NEXT_PUBLIC_SITE_URL)?.trim().replace(/\/+$/, '')
    if (!terminalKey || !password)
      throw new PaymentConfigError(
        'PAYMENT_PROVIDER=tbank needs TBANK_TERMINAL_KEY and TBANK_PASSWORD',
      )
    // Уведомления банк шлёт только на https.
    if (!site?.startsWith('https://'))
      throw new PaymentConfigError('PAYMENT_PROVIDER=tbank needs an https PUBLIC_SITE_URL')
    const provider = createTbankProvider({
      terminalKey,
      password,
      notificationUrl: `${site}/api/payments/webhook/${TBANK_PROVIDER_ID}`,
      apiUrl: env.TBANK_API_URL?.trim() || TBANK_DEFAULT_API_URL,
    })
    return { provider, fakeBank: null, testMode: terminalKey.endsWith('DEMO') }
  }
  throw new PaymentConfigError(`unknown PAYMENT_PROVIDER: ${id}`)
}
