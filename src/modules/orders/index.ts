import { createHmac } from 'node:crypto'

import { getCommerceStore, isMemoryCommerce } from '@/modules/inventory'

import { createOrderService, type OrderService } from './service'

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
