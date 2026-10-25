/**
 * Единственная state-machine статусов заказа (rules.md §3, architecture.md §8). Чистая функция:
 * сервер вычисляет переход здесь и записывает его условным UPDATE `WHERE status = <из>`, так что
 * параллельный переход проигрывает и перечитывает заказ. Напрямую статус нигде не присваивается.
 *
 *   DRAFT → PENDING_PAYMENT (бронь)
 *   PENDING_PAYMENT → PAID | EXPIRED | CANCELLED | NEEDS_REVIEW
 *   EXPIRED | CANCELLED → PAID (поздняя оплата, остаток нашёлся) | NEEDS_REVIEW (не нашёлся)
 *   PAID → PARTIALLY_REFUNDED → REFUNDED; PAID → REFUNDED; NEEDS_REVIEW → PAID | REFUNDED
 */

export type OrderStatus =
  | 'DRAFT'
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'NEEDS_REVIEW'

export type OrderEvent =
  /** Остаток зарезервирован, заказ ждёт оплату до `holdUntil`. */
  | { type: 'HOLD_PLACED'; holdUntil: Date }
  /** Провайдер подтвердил оплату, бронь была на месте. */
  | { type: 'PAYMENT_CONFIRMED'; at: Date }
  /** Подтверждена оплата заказа, бронь которого уже освобождена: остаток выделен заново. */
  | { type: 'LATE_PAYMENT_ALLOCATED'; at: Date }
  /** Деньги получены, но выдать билеты нельзя (нет остатка, неверная сумма) — разбор и возврат. */
  | { type: 'REVIEW_REQUIRED'; at: Date; reason: string }
  | { type: 'HOLD_EXPIRED'; at: Date }
  | { type: 'CANCELLED'; at: Date }
  | { type: 'REFUNDED_PARTIALLY'; at: Date }
  | { type: 'REFUNDED_FULLY'; at: Date }

export type OrderEventType = OrderEvent['type']

/** Поля заказа, которые меняет переход (кроме статуса). */
export type OrderPatch = {
  holdUntil?: Date | null
  paidAt?: Date
  closedAt?: Date
  reviewReason?: string | null
}

export type TransitionResult =
  | { ok: true; from: OrderStatus; to: OrderStatus; patch: OrderPatch }
  /** Повтор уже применённого события (дубль webhook, второй проход worker) — ничего не делать. */
  | { ok: true; from: OrderStatus; to: OrderStatus; noop: true }
  | { ok: false; error: 'INVALID_TRANSITION'; from: OrderStatus; event: OrderEventType }

const TABLE: Record<OrderEventType, Partial<Record<OrderStatus, OrderStatus>>> = {
  HOLD_PLACED: { DRAFT: 'PENDING_PAYMENT' },
  PAYMENT_CONFIRMED: { PENDING_PAYMENT: 'PAID' },
  LATE_PAYMENT_ALLOCATED: { EXPIRED: 'PAID', CANCELLED: 'PAID', NEEDS_REVIEW: 'PAID' },
  REVIEW_REQUIRED: {
    PENDING_PAYMENT: 'NEEDS_REVIEW',
    EXPIRED: 'NEEDS_REVIEW',
    CANCELLED: 'NEEDS_REVIEW',
    PAID: 'NEEDS_REVIEW',
  },
  HOLD_EXPIRED: { PENDING_PAYMENT: 'EXPIRED' },
  CANCELLED: { DRAFT: 'CANCELLED', PENDING_PAYMENT: 'CANCELLED' },
  REFUNDED_PARTIALLY: { PAID: 'PARTIALLY_REFUNDED', PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED' },
  REFUNDED_FULLY: { PAID: 'REFUNDED', PARTIALLY_REFUNDED: 'REFUNDED', NEEDS_REVIEW: 'REFUNDED' },
}

/** Повтор события в его конечном статусе — безопасный no-op, а не ошибка. */
const IDEMPOTENT: Partial<Record<OrderEventType, OrderStatus>> = {
  PAYMENT_CONFIRMED: 'PAID',
  LATE_PAYMENT_ALLOCATED: 'PAID',
  REVIEW_REQUIRED: 'NEEDS_REVIEW',
  HOLD_EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  REFUNDED_FULLY: 'REFUNDED',
}

const patchFor = (event: OrderEvent): OrderPatch => {
  switch (event.type) {
    case 'HOLD_PLACED':
      return { holdUntil: event.holdUntil }
    case 'PAYMENT_CONFIRMED':
    case 'LATE_PAYMENT_ALLOCATED':
      return { paidAt: event.at, holdUntil: null, reviewReason: null }
    case 'REVIEW_REQUIRED':
      return { reviewReason: event.reason, holdUntil: null }
    case 'HOLD_EXPIRED':
    case 'CANCELLED':
      return { closedAt: event.at, holdUntil: null }
    case 'REFUNDED_PARTIALLY':
      return {}
    case 'REFUNDED_FULLY':
      return { closedAt: event.at }
  }
}

export const transition = (order: { status: OrderStatus }, event: OrderEvent): TransitionResult => {
  const from = order.status
  const to = TABLE[event.type][from]
  if (to) return { ok: true, from, to, patch: patchFor(event) }
  if (IDEMPOTENT[event.type] === from) return { ok: true, from, to: from, noop: true }
  return { ok: false, error: 'INVALID_TRANSITION', from, event: event.type }
}

/** Конечные статусы: из них заказ больше не уходит сам (только возврат/ручной разбор). */
export const isSettled = (status: OrderStatus) =>
  status === 'PAID' || status === 'PARTIALLY_REFUNDED' || status === 'REFUNDED'

export const ORDER_TRANSITIONS = TABLE
