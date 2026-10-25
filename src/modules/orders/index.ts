import { createHmac } from 'node:crypto'

import { log } from '@/lib/log'
import { getCommerceStore, getInventory, isMemoryCommerce } from '@/modules/inventory'
import { selectPaymentProvider } from '@/modules/payments'
import { getWallet } from '@/modules/wallet'

import { createPurchaseService, type PurchaseService } from './purchase'
import { createOrderService, type OrderService } from './service'
export {
  RECONCILE_AFTER_MS,
  orderLines,
  type CheckoutError,
  type CheckoutInput,
  type CheckoutResult,
  type NotificationResult,
  type OrderStatusView,
  type PublicOrderStatus,
  type PurchaseService,
} from './purchase'
// Для маршрутов: UI не импортирует платёжный слой напрямую (tools/boundaries.ts).
export { FAKE_BANK_PATH, PaymentConfigError, type FakeBank } from '@/modules/payments'

export {
  HOLD_TTL_MS,
  PENDING_PAYMENT_GRACE_MS,
  type ConfirmPaymentInput,
  type ConfirmPaymentResult,
  type OrderService,
  type OrderView,
  type PaymentCheck,
  type PlaceOrderInput,
  type PlaceOrderLine,
  type PlaceOrderResult,
  type ReviewReason,
} from './service'

/** Секрет QR-токенов билетов — из PAYLOAD_SECRET отдельной меткой (как секрет кодов входа). */
const ticketSecret = () => {
  const base = process.env.PAYLOAD_SECRET || (isMemoryCommerce() ? 'dev' : '')
  if (!base) throw new Error('PAYLOAD_SECRET is not set')
  return createHmac('sha256', base).update('turdus:ticket').digest('hex')
}

let service: Promise<OrderService> | undefined

/** Заказы: оформление с бронью, подтверждение оплаты, отмена, истечение броней. */
export function getOrders() {
  service ??= getCommerceStore().then((store) =>
    createOrderService({ store, ticketSecret: ticketSecret() }),
  )
  service.catch(() => {
    service = undefined
  })
  return service
}

/** Секрет подписанной ссылки на статус заказа — из PAYLOAD_SECRET отдельной меткой. */
const statusSecret = () => {
  const base = process.env.PAYLOAD_SECRET || (isMemoryCommerce() ? 'dev' : '')
  if (!base) throw new Error('PAYLOAD_SECRET is not set')
  return createHmac('sha256', base).update('turdus:order-status').digest('hex')
}

/** Короткая бронь для проверки поздней оплаты на учебном банке — только вне production. */
const devHoldTtlMs = () => {
  const seconds = Number(process.env.CHECKOUT_HOLD_TTL_SECONDS)
  return process.env.NODE_ENV !== 'production' && Number.isSafeInteger(seconds) && seconds > 0
    ? seconds * 1000
    : undefined
}

let purchase: Promise<PurchaseService> | undefined

/**
 * Покупка и обработка оплаты: оформление, статус для страницы результата, уведомления банка,
 * сверка. Провайдер — по PAYMENT_PROVIDER (пусто — `available: false`, checkout честно говорит,
 * что оплата не подключена). Неверная настройка провайдера — ошибка `PaymentConfigError`.
 */
export function getPurchase() {
  purchase ??= (async () => {
    const selection = selectPaymentProvider()
    const [store, orders, inventory, wallet] = await Promise.all([
      getCommerceStore(),
      getOrders(),
      getInventory(),
      getWallet(),
    ])
    return createPurchaseService({
      orders,
      inventory,
      stock: store,
      wallet,
      provider: selection?.provider ?? null,
      statusSecret: statusSecret(),
      log: log.child({ module: 'purchase' }),
      holdTtlMs: devHoldTtlMs(),
      allowPlaceholderPrices: selection?.fakeBank != null,
    })
  })()
  purchase.catch(() => {
    purchase = undefined
  })
  return purchase
}

/** Учебный банк (страница dev): null — подключён не он (или оплата не подключена). */
export function getDevBank() {
  try {
    return selectPaymentProvider()?.fakeBank ?? null
  } catch {
    return null
  }
}
