import { log } from '@/lib/log'
import { getCommerceStore } from '@/modules/inventory'
import { selectPaymentProvider } from '@/modules/payments'
import { loadShowsData } from '@/modules/site-data'
import { performanceLookupFrom } from '@/modules/tickets/performances'
import { getWallet } from '@/modules/wallet'

import { createRefundService, type RefundService } from './service'

export { refundAmounts, reversalShare, type RefundAmounts, type TicketShare } from './amounts'
export {
  DEFAULT_REFUND_POLICY,
  MAX_DEADLINE_HOURS,
  REFUND_POLICY_KEY,
  REFUND_POLICY_PLACEHOLDER,
  customerRefundBlock,
  parseRefundPolicy,
  refundPolicySchema,
  type CustomerRefundBlock,
  type RefundPolicy,
} from './policy'
export {
  MAX_UNKNOWN_ATTEMPTS,
  PENDING_REVIEW_AFTER_MS,
  createRefundService,
  retryDelayMs,
  type CustomerRefundQuote,
  type RefundActor,
  type RefundError,
  type RefundRequestResult,
  type RefundService,
  type RefundSummary,
} from './service'
export {
  REFUND_TRANSITIONS,
  isFinalRefund,
  isLiveRefund,
  publicRefundStatus,
  refundTransition,
  type PublicRefundStatus,
  type RefundEvent,
} from './state'

/** Начало показа по источнику афиши (CMS) — для старых позиций без снимка. */
const performanceStart = async (performanceId: string) => {
  const info = performanceLookupFrom(await loadShowsData())(performanceId)
  return info ? new Date(info.startsAt) : null
}

let service: Promise<RefundService> | undefined

/**
 * Возвраты на соединении Payload (dev без базы — память, ACCOUNTS_STORE=memory). Банк — тот же
 * `PAYMENT_PROVIDER`, что у покупки; не подключён — возврат денег недоступен (честный ответ).
 */
export function getRefunds() {
  service ??= (async () => {
    const [store, wallet] = await Promise.all([getCommerceStore(), getWallet()])
    return createRefundService({
      store,
      wallet,
      provider: selectPaymentProvider()?.provider ?? null,
      performanceStart,
      log: log.child({ module: 'refunds' }),
    })
  })()
  service.catch(() => {
    service = undefined
  })
  return service
}
