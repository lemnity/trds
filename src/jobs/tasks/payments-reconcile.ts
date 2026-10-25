import { createHmac } from 'node:crypto'

import type { Logger } from '@/lib/log'
import { createInventoryService } from '@/modules/inventory/inventory'
import { pgCommerceStore } from '@/modules/inventory/pgStore'
import { createPurchaseService, type PurchaseService } from '@/modules/orders/purchase'
import { createOrderService } from '@/modules/orders/service'
import { selectPaymentProvider } from '@/modules/payments'
import type { WalletService } from '@/modules/wallet/service'

import type { Job } from '../worker'

/** Раз в минуту (не чаще такта worker): потерянный webhook виден покупателю быстро. */
export const PAYMENTS_RECONCILE_EVERY_MS = 60_000

/**
 * Сверка платежей и броней (T-045, T-048, architecture.md §12): ожидающие оплаты заказы —
 * статус у банка (потерянные webhook), истечение броней с проверкой у банка, компенсация
 * списанных бонусов у несостоявшихся заказов, доначисление бонусов оплаченным. Всё идемпотентно
 * и безопасно при нескольких worker (`expireHolds` — SKIP LOCKED, остальное — по ключам).
 */
export const paymentsReconcileJob = ({
  purchase,
  log,
  everyMs = PAYMENTS_RECONCILE_EVERY_MS,
}: {
  purchase: () => Promise<Pick<PurchaseService, 'reconcile'>>
  log: Logger
  everyMs?: number
}): Job => ({
  name: 'payments.reconcile',
  everyMs,
  run: async () => {
    const stats = await (await purchase()).reconcile()
    if (Object.values(stats).some((n) => n > 0))
      log.info('payments.reconciled', { job: 'payments.reconcile', ...stats })
  },
})

/**
 * Сервис покупки для worker — на соединении worker, без Payload. Секреты — те же метки
 * от PAYLOAD_SECRET, что у приложения (`@/modules/orders`). Неверный PAYMENT_PROVIDER роняет
 * задачу на каждом такте (ALERT_JOB_FAILED) — это сигнал, а не тихий пропуск.
 */
export const workerPurchase = ({
  db,
  wallet,
  secret,
  log,
}: {
  db: unknown
  wallet: WalletService
  secret: string
  log: Logger
}) => {
  let service: PurchaseService | undefined
  return async () => {
    if (service) return service
    const store = pgCommerceStore(db as Parameters<typeof pgCommerceStore>[0])
    const label = (name: string) => createHmac('sha256', secret).update(name).digest('hex')
    const selection = selectPaymentProvider()
    service = createPurchaseService({
      orders: createOrderService({ store, ticketSecret: label('turdus:ticket') }),
      inventory: createInventoryService({ store }),
      stock: store,
      wallet,
      provider: selection?.provider ?? null,
      statusSecret: label('turdus:order-status'),
      log: log.child({ module: 'purchase' }),
      allowPlaceholderPrices: selection?.fakeBank != null,
    })
    return service
  }
}
