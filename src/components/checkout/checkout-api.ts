import type { PaymentMethod, Selection } from '@/modules/checkout'

/**
 * Клиент `POST /api/checkout` и `GET /api/checkout/orders/<id>` (T-044). Без React — покрыт
 * тестами. Браузер присылает только выбор, контакты и пожелание по бонусам; суммы и статус
 * считает и хранит сервер — здесь их только показывают.
 */

/** Ключ попытки оформления: один на одно содержимое формы — повтор после сбоя не создаст второй заказ. */
export const newCheckoutKey = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // randomUUID есть только на https и localhost; запасной путь — те же 16 случайных байт.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export type CheckoutRequest = {
  idempotencyKey: string
  performanceId: string
  selection: Selection
  contact: {
    email: string
    name?: string
    phone?: string
    payment: PaymentMethod
    consent: true
    rulesAccepted: true
  }
  bonusKopecks: number
}

export type CheckoutOutcome =
  | { kind: 'redirect'; url: string }
  /** Оплата на сайте не подключена — честное сообщение, ничего не забронировано. */
  | { kind: 'unavailable' }
  /** Ошибка, после которой можно повторить тем же ключом (сеть, таймаут банка). */
  | { kind: 'retry'; message: string }
  /** Нужно изменить заказ: новый ключ при следующей отправке. */
  | { kind: 'error'; message: string; code: string }

const RETRY_CODES = new Set(['payment_retry', 'internal_error', 'too_many'])

const MESSAGES: Record<string, string> = {
  unavailable: 'Эти места уже заняты. Вернитесь к выбору и выберите другие.',
  invalid_selection: 'Выбор билетов устарел. Вернитесь к выбору билетов.',
  order_closed: 'Бронь истекла. Нажмите «Оплатить» ещё раз — оформим новый заказ.',
  bonus_changed: 'Бонусный баланс изменился. Проверьте сумму списания и повторите.',
  payment_failed: 'Банк не принял платёж. Деньги не списаны — попробуйте ещё раз.',
  payment_retry: 'Банк не ответил вовремя. Повторите — второго платежа не будет.',
  performance_unavailable: 'Продажа на этот показ закрыта.',
  too_many: 'Слишком много попыток. Подождите несколько минут.',
  method_unavailable: 'Этот способ оплаты пока недоступен.',
}

const httpUrl = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  try {
    const base = typeof window === 'undefined' ? undefined : window.location.origin
    const url = new URL(raw, base)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

export async function submitCheckout(
  request: CheckoutRequest,
  fetcher: typeof fetch = fetch,
): Promise<CheckoutOutcome> {
  let res: Response
  try {
    res = await fetcher('/api/checkout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(45_000),
    })
  } catch {
    return { kind: 'retry', message: 'Нет связи с сервером. Проверьте интернет и повторите.' }
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (res.ok && data?.ok === true) {
    const url = httpUrl(data.redirectUrl)
    if (url) return { kind: 'redirect', url }
    return { kind: 'retry', message: 'Не удалось перейти к оплате. Повторите.' }
  }
  const code = typeof data?.code === 'string' ? data.code : 'internal_error'
  if (code === 'payment_unavailable') return { kind: 'unavailable' }
  const message = MESSAGES[code] ?? 'Не удалось оформить заказ. Повторите через минуту.'
  if (RETRY_CODES.has(code)) return { kind: 'retry', message }
  return { kind: 'error', code, message }
}

export type OrderStatusResponse = {
  orderId: string
  orderNumber: string
  status: 'pending' | 'paid' | 'refunded' | 'failed' | 'expired' | 'review'
  amountKopecks: number
  ticketCount: number
  holdUntil: string | null
}

const STATUSES = new Set(['pending', 'paid', 'refunded', 'failed', 'expired', 'review'])

/** null — заказ не найден/ссылка не подходит; 'error' — временный сбой (повторить позже). */
export async function fetchOrderStatus(
  orderId: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<OrderStatusResponse | null | 'error'> {
  try {
    const res = await fetcher(
      `/api/checkout/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`,
      { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15_000) },
    )
    if (res.status === 404) return null
    if (!res.ok) return 'error'
    const data = (await res.json()) as OrderStatusResponse
    return STATUSES.has(data.status) && typeof data.orderNumber === 'string' ? data : 'error'
  } catch {
    return 'error'
  }
}
