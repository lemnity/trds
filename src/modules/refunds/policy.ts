import { z } from 'zod'

/**
 * Политика возвратов (T-052/T-053/T-064, PRD §5.4, architecture.md §10). Правила театр ещё
 * НЕ утвердил (PRD §11 п.3, п.5): срок, частичный возврат, сервисный сбор, судьба места. Поэтому
 * это настройка (`commerce_settings`, ключ `refund_policy`, правит администратор театра в админке),
 * а значения ниже — ЗАГЛУШКИ: возврат из кабинета по умолчанию выключен, кабинет честно пишет
 * «Возврат через кассу театра / по почте». Возвраты сотрудником (касса/администратор) работают
 * всегда — они обходят срок и флаг, но не финансовые инварианты.
 *
 * Бонусы при возврате — правило PRD §5.6 (не настройка): начисленные за билеты сторнируются,
 * потраченные на них возвращаются; если начисленное уже потрачено — долг внутри ledger,
 * доступный баланс не уходит в минус. Театр должен подтвердить это правило (T-064).
 */
export type RefundPolicy = {
  /** Возврат из личного кабинета. Выключен — только через кассу/почту театра. */
  customerRefundsEnabled: boolean
  /** Не позже чем за столько часов до начала показа (для зрителя; сотрудник обходит). */
  deadlineHoursBeforeStart: number
  /** Зритель может вернуть часть билетов заказа; иначе — только все оставшиеся вместе. */
  allowPartial: boolean
  /** Возвращать ли сервисный сбор при возврате зрителем. */
  refundServiceFee: boolean
  /** После возврата место/квота снова в продаже (иначе остаётся проданным). */
  returnToSale: boolean
}

export const REFUND_POLICY_KEY = 'refund_policy'

/** ЗАГЛУШКИ до решения театра (PRD §11 п.3). Не выдавать за утверждённые правила. */
export const DEFAULT_REFUND_POLICY: RefundPolicy = {
  customerRefundsEnabled: false,
  deadlineHoursBeforeStart: 72,
  allowPartial: true,
  refundServiceFee: false,
  returnToSale: true,
}

export const REFUND_POLICY_PLACEHOLDER = true

export const MAX_DEADLINE_HOURS = 24 * 90

export const refundPolicySchema = z.object({
  customerRefundsEnabled: z.boolean(),
  deadlineHoursBeforeStart: z.number().int().min(0).max(MAX_DEADLINE_HOURS),
  allowPartial: z.boolean(),
  refundServiceFee: z.boolean(),
  returnToSale: z.boolean(),
})

/**
 * Политика из хранилища: неизвестные и битые значения не применяются — берётся заглушка по
 * умолчанию для каждого поля (лучше «возврат через кассу», чем случайно открытый возврат).
 */
export const parseRefundPolicy = (value: unknown): RefundPolicy => {
  const merged = { ...DEFAULT_REFUND_POLICY, ...(typeof value === 'object' && value ? value : {}) }
  const parsed = refundPolicySchema.safeParse(merged)
  return parsed.success ? parsed.data : DEFAULT_REFUND_POLICY
}

/** Почему зритель не может вернуть билеты сам (UI показывает понятный текст и канал театра). */
export type CustomerRefundBlock =
  /** Возврат в кабинете выключен политикой (по умолчанию — до решения театра). */
  | 'DISABLED'
  /** До начала показа меньше `deadlineHoursBeforeStart`. */
  | 'DEADLINE_PASSED'
  /** Время показа неизвестно — без него срок не проверить. */
  | 'SHOW_TIME_UNKNOWN'
  /** Билет не действует (возвращён, в процессе возврата, заказ на проверке). */
  | 'NOT_REFUNDABLE'
  /** Частичный возврат запрещён — вернуть можно только все оставшиеся билеты заказа. */
  | 'PARTIAL_NOT_ALLOWED'

/**
 * Можно ли зрителю вернуть эти билеты сейчас. Чистая функция: сервер вызывает её до запроса
 * (для кнопки и суммы) и повторно под блокировкой заказа (PRD §5.4 п.2).
 */
export const customerRefundBlock = ({
  policy,
  startsAt,
  now,
  requested,
  refundable,
}: {
  policy: RefundPolicy
  /** Начало самого раннего показа среди билетов; null — неизвестно. */
  startsAt: Date | null
  now: Date
  /** Сколько билетов зритель возвращает. */
  requested: number
  /** Сколько билетов заказа ещё можно вернуть (выпущены и без живого возврата). */
  refundable: number
}): CustomerRefundBlock | null => {
  if (!policy.customerRefundsEnabled) return 'DISABLED'
  if (requested === 0 || requested > refundable) return 'NOT_REFUNDABLE'
  if (!startsAt || Number.isNaN(startsAt.getTime())) return 'SHOW_TIME_UNKNOWN'
  const deadline = startsAt.getTime() - policy.deadlineHoursBeforeStart * 3_600_000
  if (now.getTime() > deadline) return 'DEADLINE_PASSED'
  if (!policy.allowPartial && requested !== refundable) return 'PARTIAL_NOT_ALLOWED'
  return null
}
