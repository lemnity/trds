import type { Logger } from '@/lib/log'
import { pgCommerceStore } from '@/modules/inventory/pgStore'
import { selectPaymentProvider } from '@/modules/payments'
import { createRefundService, type RefundService } from '@/modules/refunds/service'
import type { WalletService } from '@/modules/wallet/service'

import type { Job } from '../worker'

/** Раз в минуту (не чаще такта worker): «в процессе» у зрителя не висит дольше нужного. */
export const REFUNDS_RECONCILE_EVERY_MS = 60_000

/**
 * Сверка возвратов (T-052/T-053, architecture.md §12 «повтор/проверка возвратов»): запросы с
 * неизвестным исходом (таймаут) — повтор с тем же ключом банка `refund:<id>`; «в обработке» —
 * статус у банка; после лимита — MANUAL_REVIEW и ALERT_PAYMENT_REVIEW; успешные без компенсации
 * бонусов — доделать. Всё идемпотентно: несколько worker и повтор такта деньги дважды не вернут.
 */
export const refundsReconcileJob = ({
  refunds,
  log,
  everyMs = REFUNDS_RECONCILE_EVERY_MS,
}: {
  refunds: () => Promise<Pick<RefundService, 'reconcile'>>
  log: Logger
  everyMs?: number
}): Job => ({
  name: 'refunds.reconcile',
  everyMs,
  run: async () => {
    const stats = await (await refunds()).reconcile()
    if (Object.values(stats).some((n) => n > 0))
      log.info('refunds.reconciled', { job: 'refunds.reconcile', ...stats })
  },
})

/**
 * Сервис возвратов для worker — на соединении worker, без Payload: срок возврата здесь не
 * проверяется (он проверен при открытии), поэтому источник афиши не нужен.
 */
export const workerRefunds = ({
  db,
  wallet,
  log,
}: {
  db: unknown
  wallet: WalletService
  log: Logger
}) => {
  let service: RefundService | undefined
  return async () =>
    (service ??= createRefundService({
      store: pgCommerceStore(db as Parameters<typeof pgCommerceStore>[0]),
      wallet,
      provider: selectPaymentProvider()?.provider ?? null,
      log: log.child({ module: 'refunds' }),
    }))
}
