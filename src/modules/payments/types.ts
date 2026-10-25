/**
 * Контракт платёжного провайдера (T-043, rules.md §2, architecture.md §9). Банк театра ещё не
 * выбран (T-001), поэтому здесь только доменно-нейтральные типы: суммы — целые копейки, статусы —
 * свои, а не поля SDK. Адаптер конкретного банка живёт в `providers/<bank>.ts` и переводит его
 * API в этот контракт; бизнес-код (`@/modules/orders`) знает только `PaymentProvider`.
 *
 * Правила для любого адаптера:
 * - `createPayment` идемпотентен по `idempotencyKey`: повтор с тем же ключом возвращает тот же
 *   платёж (банковский idempotency key или собственная проверка по метаданным заказа);
 * - `getPayment` — авторитетный ответ банка (server-to-server). Только по нему подтверждается
 *   оплата: сумма, валюта и связь с заказом (`orderId` из метаданных платежа);
 * - `parseNotification` проверяет подлинность уведомления строго по документации банка
 *   (подпись/IP/секрет) и возвращает только идентификаторы — содержимому уведомления не верим;
 * - ошибки — `PaymentProviderError` с видом: можно ли повторять и известен ли исход.
 */

export type Currency = 'RUB'

/** Статус платежа у провайдера в терминах домена. */
export type ProviderPaymentStatus =
  /** Создан, ждёт действий покупателя или банка (в т.ч. 3-D Secure, СБП). */
  | 'pending'
  /** Деньги списаны с покупателя — окончательно. */
  | 'succeeded'
  /** Отклонён, отменён или истёк — окончательно, денег нет. */
  | 'canceled'

export type PaymentMethodHint = 'card' | 'sbp'

export type CreatePaymentInput = {
  /** Стабилен для одного заказа: `payment:<orderId>`. Повтор не создаёт второй платёж. */
  idempotencyKey: string
  orderId: string
  orderNumber: string
  amountKopecks: number
  currency: Currency
  /** Короткое описание для страницы банка, без ПД. */
  description: string
  /** Куда банк вернёт покупателя. Факт оплаты по возврату не принимается. */
  returnUrl: string
  /** Пожелание покупателя; адаптер может игнорировать. */
  method?: PaymentMethodHint
  /**
   * Почта для чека 54-ФЗ — передаётся, только если схема чека банка её требует (T-002).
   * Адаптер не логирует её и не кладёт в метаданные.
   */
  receiptEmail?: string
}

export type CreatedPayment = {
  providerPaymentId: string
  status: ProviderPaymentStatus
  /** Страница оплаты банка; null — подтверждение не требуется (уже оплачен/отменён). */
  confirmationUrl: string | null
}

/** Платёж по данным провайдера (server-to-server). */
export type ProviderPayment = {
  providerPaymentId: string
  /** Наш заказ из метаданных платежа; null — платёж создан не нами/без метаданных. */
  orderId: string | null
  status: ProviderPaymentStatus
  amountKopecks: number
  currency: string
}

export type RefundInput = {
  /** Стабилен для одной операции возврата (T-052/T-053). */
  idempotencyKey: string
  providerPaymentId: string
  amountKopecks: number
  currency: Currency
}

export type ProviderRefund = {
  providerRefundId: string
  status: 'pending' | 'succeeded' | 'canceled'
  amountKopecks: number
}

/** Входящее уведомление: сырое тело (для подписи) и заголовки. */
export type NotificationRequest = {
  headers: Headers
  rawBody: string
  /** IP отправителя (за прокси — из X-Forwarded-For), если банк проверяет источник по IP. */
  remoteIp?: string
}

export type ParsedNotification =
  | {
      ok: true
      /** Уникален у провайдера для одной доставки события (дедупликация). */
      eventId: string
      eventType: string
      providerPaymentId: string
    }
  /** Подлинное уведомление, которое нам не нужно (другие события банка). */
  | { ok: true; ignored: true; eventType: string }
  | { ok: false; error: 'UNAUTHENTICATED' | 'MALFORMED' }

export interface PaymentProvider {
  /** Код провайдера в URL webhook и в `commerce_orders.payment_provider`. */
  readonly id: string
  createPayment(input: CreatePaymentInput, signal?: AbortSignal): Promise<CreatedPayment>
  /** null — провайдер такого платежа не знает. */
  getPayment(providerPaymentId: string, signal?: AbortSignal): Promise<ProviderPayment | null>
  refund(input: RefundInput, signal?: AbortSignal): Promise<ProviderRefund>
  parseNotification(request: NotificationRequest): Promise<ParsedNotification>
}

export type ProviderErrorKind =
  /** Не дождались ответа: исход неизвестен, повторять только с тем же ключом. */
  | 'timeout'
  /** Банк недоступен/5xx: запрос не принят, повтор безопасен. */
  | 'unavailable'
  /** Банк отказал окончательно (неверные данные, конфликт ключа, отказ в операции). */
  | 'rejected'

export class PaymentProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'PaymentProviderError'
  }
}
