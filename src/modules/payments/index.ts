/**
 * Платёжный слой (T-043): контракт `PaymentProvider`, вызов с таймаутом/повтором и выбор
 * провайдера по окружению. UI сюда не обращается (tools/boundaries.ts) — покупка и обработка
 * оплаты — use-case `@/modules/orders` (`getPurchase`).
 */
export {
  PaymentProviderError,
  type CreatePaymentInput,
  type CreatedPayment,
  type Currency,
  type NotificationRequest,
  type ParsedNotification,
  type PaymentMethodHint,
  type PaymentProvider,
  type ProviderErrorKind,
  type ProviderPayment,
  type ProviderPaymentStatus,
  type ProviderRefund,
  type RefundInput,
} from './types'
export { PROVIDER_ATTEMPTS, PROVIDER_TIMEOUT_MS, callProvider, type CallOptions } from './call'
export { PaymentConfigError, selectPaymentProvider, type ProviderSelection } from './providers'
export {
  FAKE_BANK_PATH,
  FAKE_PROVIDER_ID,
  FAKE_SIGNATURE_HEADER,
  createFakeProvider,
  fakeBankState,
  type FakeBank,
  type FakePayment,
} from './providers/fake'
