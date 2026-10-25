import type { RefundStatus } from '@/modules/inventory/store'

/**
 * Единственная state-machine статусов возврата (rules.md §3, architecture.md §8, §10). Чистая
 * функция; сервис записывает переход условным UPDATE `WHERE status = <из>`.
 *
 *   REQUESTED → PENDING (банк принял, ещё обрабатывает) | SUCCEEDED | FAILED | MANUAL_REVIEW
 *   PENDING   → SUCCEEDED | FAILED | MANUAL_REVIEW
 *   MANUAL_REVIEW → SUCCEEDED | FAILED (сверка увидела итог у банка)
 *
 * Неизвестный исход (таймаут) статус не меняет: остаётся REQUESTED/PENDING, сверка повторяет
 * запрос с тем же ключом банка. SUCCEEDED и FAILED — конечные. Для зрителя:
 * REQUESTED/PENDING/MANUAL_REVIEW — «в процессе», SUCCEEDED — «подтверждён», FAILED — «отклонён».
 */

export type RefundEvent =
  | 'PROVIDER_PENDING'
  | 'PROVIDER_SUCCEEDED'
  /** Банк отказал или отменил возврат — деньги не ушли. */
  | 'PROVIDER_FAILED'
  /** Попытки исчерпаны или ответ противоречив — разбирает сотрудник. */
  | 'NEEDS_MANUAL_REVIEW'

const TABLE: Record<RefundEvent, Partial<Record<RefundStatus, RefundStatus>>> = {
  PROVIDER_PENDING: { REQUESTED: 'PENDING' },
  PROVIDER_SUCCEEDED: { REQUESTED: 'SUCCEEDED', PENDING: 'SUCCEEDED', MANUAL_REVIEW: 'SUCCEEDED' },
  PROVIDER_FAILED: { REQUESTED: 'FAILED', PENDING: 'FAILED', MANUAL_REVIEW: 'FAILED' },
  NEEDS_MANUAL_REVIEW: { REQUESTED: 'MANUAL_REVIEW', PENDING: 'MANUAL_REVIEW' },
}

/** Повтор события в его конечном статусе — безопасный no-op. */
const IDEMPOTENT: Partial<Record<RefundEvent, RefundStatus>> = {
  PROVIDER_PENDING: 'PENDING',
  PROVIDER_SUCCEEDED: 'SUCCEEDED',
  PROVIDER_FAILED: 'FAILED',
  NEEDS_MANUAL_REVIEW: 'MANUAL_REVIEW',
}

export type RefundTransition =
  | { ok: true; from: RefundStatus; to: RefundStatus; noop?: true }
  | { ok: false; from: RefundStatus; event: RefundEvent }

export const refundTransition = (from: RefundStatus, event: RefundEvent): RefundTransition => {
  const to = TABLE[event][from]
  if (to) return { ok: true, from, to }
  if (IDEMPOTENT[event] === from) return { ok: true, from, to: from, noop: true }
  return { ok: false, from, event }
}

export const isFinalRefund = (status: RefundStatus) => status === 'SUCCEEDED' || status === 'FAILED'

/** Возврат ещё в работе: билеты в REFUND_PENDING, деньги не подтверждены. */
export const isLiveRefund = (status: RefundStatus) => !isFinalRefund(status)

/** Статус для зрителя (ACCOUNT-04): только серверное состояние, без внутренних деталей. */
export type PublicRefundStatus = 'processing' | 'succeeded' | 'failed'

export const publicRefundStatus = (status: RefundStatus): PublicRefundStatus =>
  status === 'SUCCEEDED' ? 'succeeded' : status === 'FAILED' ? 'failed' : 'processing'

export const REFUND_TRANSITIONS = TABLE
