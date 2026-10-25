import { sql } from '@payloadcms/db-postgres/drizzle'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from '@payloadcms/db-postgres/drizzle/pg-core'

import { customers } from './accounts'

/**
 * Транзакционное ядро продаж (T-040, architecture.md §6): остатки, места, заказы, брони, билеты,
 * платёжные события, возвраты, outbox и журнал аудита. Подключаются к схеме Payload через
 * `beforeSchemaInit` (payload.config.ts). Это не коллекции CMS: сотрудники не правят суммы,
 * остатки и статусы руками (rules.md §2) — только доменный слой `@/modules/inventory`/`orders`.
 *
 * Деньги — BIGINT в копейках, инварианты продублированы CHECK-ограничениями: даже ошибка в коде
 * не запишет `sold + held > capacity` или заказ с несходящейся суммой.
 */

export const ORDER_STATUSES = [
  'DRAFT',
  'PENDING_PAYMENT',
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'EXPIRED',
  'CANCELLED',
  'NEEDS_REVIEW',
] as const
export const SEAT_STATUSES = ['free', 'held', 'sold', 'blocked'] as const
export const HOLD_STATUSES = ['ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED'] as const
export const TICKET_STATUSES = ['ISSUED', 'REFUND_PENDING', 'REFUNDED'] as const
export const REFUND_STATUSES = [
  'REQUESTED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'MANUAL_REVIEW',
] as const
export const REFUND_KINDS = ['customer', 'staff'] as const
export const OUTBOX_STATUSES = ['pending', 'processing', 'done', 'dead'] as const

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull()

/**
 * Остаток категории показа (продажа без мест). Резерв — условный UPDATE под блокировкой строки;
 * CHECK `sold + held <= capacity` — последняя линия защиты от перепродажи.
 */
export const commerceInventory = pgTable(
  'commerce_inventory',
  {
    performanceId: text('performance_id').notNull(),
    ticketTypeId: text('ticket_type_id').notNull(),
    capacity: integer('capacity').notNull(),
    sold: integer('sold').notNull().default(0),
    held: integer('held').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.performanceId, t.ticketTypeId] }),
    index('commerce_inventory_ticket_type_idx').on(t.ticketTypeId),
    check('commerce_inventory_capacity_nonneg', sql`${t.capacity} >= 0`),
    check('commerce_inventory_sold_nonneg', sql`${t.sold} >= 0`),
    check('commerce_inventory_held_nonneg', sql`${t.held} >= 0`),
    check('commerce_inventory_within_capacity', sql`${t.sold} + ${t.held} <= ${t.capacity}`),
  ],
)

/**
 * Заказ. `customer_id` пуст у гостя (покупка только по почте). Статус меняет только
 * state-machine `transition` (`@/modules/checkout`) условным UPDATE `WHERE status = <из>`.
 * Сумма: к оплате деньгами = билеты − бонусы + сервисный сбор (как `applyBonus`).
 */
export const commerceOrders = pgTable(
  'commerce_orders',
  {
    id: uuid('id').primaryKey(),
    /** Номер для зрителя и кассы (TRD-XXXXXXXX), не раскрывает объём продаж. */
    number: text('number').notNull().unique(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    status: text('status', { enum: ORDER_STATUSES }).notNull(),
    grossKopecks: bigint('gross_kopecks', { mode: 'number' }).notNull(),
    bonusKopecks: bigint('bonus_kopecks', { mode: 'number' }).notNull(),
    feeKopecks: bigint('fee_kopecks', { mode: 'number' }).notNull(),
    cashKopecks: bigint('cash_kopecks', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('RUB'),
    holdUntil: timestamp('hold_until', { withTimezone: true }),
    /** Ключ идемпотентности оформления: повтор запроса возвращает тот же заказ. */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    /** Отпечаток запроса: тот же ключ с другим составом — конфликт, а не чужой заказ. */
    requestHash: text('request_hash').notNull(),
    paymentProvider: text('payment_provider'),
    providerPaymentId: text('provider_payment_id'),
    /** Почему заказ требует ручного разбора (поздняя оплата без остатка, неверная сумма). */
    reviewReason: text('review_reason'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('commerce_orders_status_hold_idx').on(t.status, t.holdUntil),
    index('commerce_orders_customer_idx').on(t.customerId, t.createdAt),
    index('commerce_orders_email_idx').on(t.email),
    uniqueIndex('commerce_orders_provider_payment_uq')
      .on(t.paymentProvider, t.providerPaymentId)
      .where(sql`${t.providerPaymentId} IS NOT NULL`),
    check(
      'commerce_orders_amounts_nonneg',
      sql`${t.grossKopecks} >= 0 AND ${t.bonusKopecks} >= 0 AND ${t.feeKopecks} >= 0 AND ${t.cashKopecks} >= 0`,
    ),
    check('commerce_orders_bonus_within_gross', sql`${t.bonusKopecks} <= ${t.grossKopecks}`),
    check(
      'commerce_orders_cash_formula',
      sql`${t.cashKopecks} = ${t.grossKopecks} - ${t.bonusKopecks} + ${t.feeKopecks}`,
    ),
    check('commerce_orders_currency', sql`${t.currency} = 'RUB'`),
    check(
      'commerce_orders_pending_has_hold',
      sql`${t.status} <> 'PENDING_PAYMENT' OR ${t.holdUntil} IS NOT NULL`,
    ),
    check('commerce_orders_paid_at', sql`${t.status} <> 'PAID' OR ${t.paidAt} IS NOT NULL`),
  ],
)

/**
 * Место показа (продажа по схеме зала). Строки создаёт синхронизация со схемой;
 * `held` — у брони (`hold_id`) и заказа, `sold` — у заказа. Цена — по категории места.
 */
export const commerceSeats = pgTable(
  'commerce_seats',
  {
    performanceId: text('performance_id').notNull(),
    seatId: text('seat_id').notNull(),
    planId: text('plan_id').notNull(),
    planVersion: integer('plan_version').notNull(),
    categoryId: text('category_id').notNull(),
    status: text('status', { enum: SEAT_STATUSES }).notNull(),
    holdId: uuid('hold_id').references(() => commerceHolds.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id').references(() => commerceOrders.id, { onDelete: 'restrict' }),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.performanceId, t.seatId] }),
    index('commerce_seats_hold_idx').on(t.holdId),
    index('commerce_seats_order_idx').on(t.orderId),
    check('commerce_seats_hold_shape', sql`(${t.status} = 'held') = (${t.holdId} IS NOT NULL)`),
    check(
      'commerce_seats_order_shape',
      sql`(${t.status} IN ('held', 'sold')) = (${t.orderId} IS NOT NULL)`,
    ),
  ],
)

/** Бронь заказа (15 минут, PRD §5.2). Позиции брони — позиции заказа. Одна бронь на заказ. */
export const commerceHolds = pgTable(
  'commerce_holds',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .unique()
      .references(() => commerceOrders.id, { onDelete: 'restrict' }),
    status: text('status', { enum: HOLD_STATUSES }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    index('commerce_holds_status_expires_idx').on(t.status, t.expiresAt),
    check('commerce_holds_closed_shape', sql`(${t.status} = 'ACTIVE') = (${t.closedAt} IS NULL)`),
  ],
)

/**
 * Позиция заказа: категория × количество или одно место. Цена и название — снимок на момент
 * оформления (TICKETS-03). Бонусы распределены по позициям `allocate` (наибольший остаток).
 */
export const commerceOrderItems = pgTable(
  'commerce_order_items',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => commerceOrders.id, { onDelete: 'restrict' }),
    performanceId: text('performance_id').notNull(),
    /** Категория билета; для места — ценовая категория места. */
    ticketTypeId: text('ticket_type_id').notNull(),
    seatId: text('seat_id'),
    titleSnapshot: text('title_snapshot').notNull(),
    /**
     * Снимок показа на момент оформления: билет, письмо и worker не зависят от CMS и демо-данных
     * (у старых позиций — NULL, тогда данные берутся из афиши).
     */
    showTitleSnapshot: text('show_title_snapshot'),
    showSlugSnapshot: text('show_slug_snapshot'),
    startsAtSnapshot: timestamp('starts_at_snapshot', { withTimezone: true }),
    venueTitleSnapshot: text('venue_title_snapshot'),
    venueAddressSnapshot: text('venue_address_snapshot'),
    unitPriceKopecks: bigint('unit_price_kopecks', { mode: 'number' }).notNull(),
    quantity: integer('quantity').notNull(),
    lineGrossKopecks: bigint('line_gross_kopecks', { mode: 'number' }).notNull(),
    lineBonusKopecks: bigint('line_bonus_kopecks', { mode: 'number' }).notNull(),
    lineCashKopecks: bigint('line_cash_kopecks', { mode: 'number' }).notNull(),
    lineFeeKopecks: bigint('line_fee_kopecks', { mode: 'number' }).notNull(),
  },
  (t) => [
    index('commerce_order_items_order_idx').on(t.orderId),
    index('commerce_order_items_ticket_type_idx').on(t.performanceId, t.ticketTypeId),
    uniqueIndex('commerce_order_items_category_uq')
      .on(t.orderId, t.performanceId, t.ticketTypeId)
      .where(sql`${t.seatId} IS NULL`),
    uniqueIndex('commerce_order_items_seat_uq')
      .on(t.orderId, t.performanceId, t.seatId)
      .where(sql`${t.seatId} IS NOT NULL`),
    foreignKey({
      name: 'commerce_order_items_seat_fk',
      columns: [t.performanceId, t.seatId],
      foreignColumns: [commerceSeats.performanceId, commerceSeats.seatId],
    }),
    check('commerce_order_items_quantity', sql`${t.quantity} > 0`),
    check('commerce_order_items_seat_single', sql`${t.seatId} IS NULL OR ${t.quantity} = 1`),
    check(
      'commerce_order_items_amounts',
      sql`${t.unitPriceKopecks} >= 0 AND ${t.lineBonusKopecks} >= 0 AND ${t.lineFeeKopecks} >= 0`,
    ),
    check(
      'commerce_order_items_gross',
      sql`${t.lineGrossKopecks} = ${t.unitPriceKopecks} * ${t.quantity}`,
    ),
    check(
      'commerce_order_items_cash',
      sql`${t.lineBonusKopecks} <= ${t.lineGrossKopecks} AND ${t.lineCashKopecks} = ${t.lineGrossKopecks} - ${t.lineBonusKopecks}`,
    ),
  ],
)

/**
 * Билет. Номер стабилен (номер заказа + порядковый), токен QR — HMAC от id билета на серверном
 * секрете; в базе только SHA-256 токена. ПД в билете нет (TICKETS-05). Доля бонусов и денег
 * каждого билета записана при выпуске — по ней считается частичный возврат.
 * Одно место не может быть продано дважды: уникальный индекс по живым билетам на место.
 */
export const commerceTickets = pgTable(
  'commerce_tickets',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull().unique(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => commerceOrders.id, { onDelete: 'restrict' }),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => commerceOrderItems.id, { onDelete: 'restrict' }),
    performanceId: text('performance_id').notNull(),
    ticketTypeId: text('ticket_type_id').notNull(),
    seatId: text('seat_id'),
    tokenHash: text('token_hash').notNull().unique(),
    tokenVersion: integer('token_version').notNull(),
    status: text('status', { enum: TICKET_STATUSES }).notNull(),
    priceKopecks: bigint('price_kopecks', { mode: 'number' }).notNull(),
    bonusKopecks: bigint('bonus_kopecks', { mode: 'number' }).notNull(),
    cashKopecks: bigint('cash_kopecks', { mode: 'number' }).notNull(),
    feeKopecks: bigint('fee_kopecks', { mode: 'number' }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
  },
  (t) => [
    index('commerce_tickets_order_idx').on(t.orderId),
    index('commerce_tickets_ticket_type_idx').on(t.performanceId, t.ticketTypeId),
    uniqueIndex('commerce_tickets_seat_live_uq')
      .on(t.performanceId, t.seatId)
      .where(sql`${t.seatId} IS NOT NULL AND ${t.status} <> 'REFUNDED'`),
    foreignKey({
      name: 'commerce_tickets_seat_fk',
      columns: [t.performanceId, t.seatId],
      foreignColumns: [commerceSeats.performanceId, commerceSeats.seatId],
    }),
    check(
      'commerce_tickets_amounts',
      sql`${t.priceKopecks} >= 0 AND ${t.bonusKopecks} >= 0 AND ${t.feeKopecks} >= 0 AND ${t.bonusKopecks} <= ${t.priceKopecks} AND ${t.cashKopecks} = ${t.priceKopecks} - ${t.bonusKopecks}`,
    ),
    check(
      'commerce_tickets_refunded_shape',
      sql`(${t.status} = 'REFUNDED') = (${t.refundedAt} IS NOT NULL)`,
    ),
  ],
)

/**
 * Уведомления провайдера (at-least-once): `event_id` уникален в пределах провайдера — повтор
 * webhook не обрабатывается дважды. Payload — минимальный, без карточных данных и секретов.
 */
export const commercePaymentEvents = pgTable(
  'commerce_payment_events',
  {
    id: uuid('id').primaryKey(),
    provider: text('provider').notNull(),
    providerPaymentId: text('provider_payment_id').notNull(),
    eventId: text('event_id').notNull(),
    orderId: uuid('order_id').references(() => commerceOrders.id, { onDelete: 'restrict' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    correlationId: text('correlation_id'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    result: text('result'),
  },
  (t) => [
    uniqueIndex('commerce_payment_events_dedupe_uq').on(t.provider, t.eventId),
    index('commerce_payment_events_payment_idx').on(t.provider, t.providerPaymentId),
    index('commerce_payment_events_unprocessed_idx')
      .on(t.receivedAt)
      .where(sql`${t.processedAt} IS NULL`),
  ],
)

/**
 * Возврат (T-052/T-053, architecture.md §10): деньги и бонусы отдельно; повтор запроса с тем же
 * ключом — тот же возврат. `cash_kopecks` — вся сумма на карту (включая возвращаемый сбор),
 * `fee_kopecks` — часть её, приходящаяся на сервисный сбор; `bonus_kopecks` — потраченные бонусы,
 * которые вернутся на счёт; `bonus_reversal_kopecks` — сторно начисленных 3% (известно после
 * компенсации, `bonus_settled_at`). Ключ банка — `refund:<id>`, стабилен для всех повторов.
 * Статус меняет только state-machine `@/modules/refunds` условным UPDATE.
 */
export const commerceRefunds = pgTable(
  'commerce_refunds',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => commerceOrders.id, { onDelete: 'restrict' }),
    status: text('status', { enum: REFUND_STATUSES }).notNull(),
    /** Кто инициировал: зритель из кабинета или сотрудник в админке. */
    kind: text('kind', { enum: REFUND_KINDS }).notNull().default('customer'),
    cashKopecks: bigint('cash_kopecks', { mode: 'number' }).notNull(),
    bonusKopecks: bigint('bonus_kopecks', { mode: 'number' }).notNull(),
    feeKopecks: bigint('fee_kopecks', { mode: 'number' }).notNull(),
    bonusReversalKopecks: bigint('bonus_reversal_kopecks', { mode: 'number' }).notNull().default(0),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    provider: text('provider'),
    providerRefundId: text('provider_refund_id'),
    /** Последний ответ банка в терминах домена (pending/succeeded/canceled/timeout/…), без ПД. */
    providerStatus: text('provider_status'),
    /** Сколько раз обращались к банку (сверка повторяет до лимита, затем — ручной разбор). */
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    reason: text('reason').notNull(),
    requestedBy: text('requested_by').notNull(),
    correlationId: text('correlation_id'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Бонусы компенсированы (сторно начисления, возврат потраченных) — шаг после успеха. */
    bonusSettledAt: timestamp('bonus_settled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('commerce_refunds_order_idx').on(t.orderId),
    index('commerce_refunds_status_idx').on(t.status, t.updatedAt),
    index('commerce_refunds_next_attempt_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} IN ('REQUESTED', 'PENDING')`),
    uniqueIndex('commerce_refunds_provider_refund_uq')
      .on(t.provider, t.providerRefundId)
      .where(sql`${t.providerRefundId} IS NOT NULL`),
    check(
      'commerce_refunds_amounts',
      sql`${t.cashKopecks} >= 0 AND ${t.bonusKopecks} >= 0 AND ${t.feeKopecks} >= 0 AND ${t.feeKopecks} <= ${t.cashKopecks} AND ${t.bonusReversalKopecks} >= 0`,
    ),
    check('commerce_refunds_attempts_nonneg', sql`${t.attempts} >= 0`),
    check(
      'commerce_refunds_completed_shape',
      sql`(${t.status} IN ('SUCCEEDED', 'FAILED')) = (${t.completedAt} IS NOT NULL)`,
    ),
  ],
)

/**
 * Какие билеты входят в возврат и какая доля денег/бонусов каждого. Один билет — не более
 * одного живого возврата (`voided_at` ставится только у неудавшегося, чтобы повторить).
 */
export const commerceRefundTickets = pgTable(
  'commerce_refund_tickets',
  {
    refundId: uuid('refund_id')
      .notNull()
      .references(() => commerceRefunds.id, { onDelete: 'restrict' }),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => commerceTickets.id, { onDelete: 'restrict' }),
    cashKopecks: bigint('cash_kopecks', { mode: 'number' }).notNull(),
    bonusKopecks: bigint('bonus_kopecks', { mode: 'number' }).notNull(),
    feeKopecks: bigint('fee_kopecks', { mode: 'number' }).notNull(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.refundId, t.ticketId] }),
    uniqueIndex('commerce_refund_tickets_live_uq')
      .on(t.ticketId)
      .where(sql`${t.voidedAt} IS NULL`),
    check(
      'commerce_refund_tickets_amounts',
      sql`${t.cashKopecks} >= 0 AND ${t.bonusKopecks} >= 0 AND ${t.feeKopecks} >= 0`,
    ),
  ],
)

/**
 * Outbox: внешние эффекты (письма, уведомления, автовозврат) записываются в той же транзакции,
 * что и смена статуса, а выполняет их worker с retry/backoff. `dedupe_key` — одно событие
 * на операцию даже при повторе.
 */
export const commerceOutbox = pgTable(
  'commerce_outbox',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    aggregateId: text('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status', { enum: OUTBOX_STATUSES }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
    lastError: text('last_error'),
    createdAt: createdAt(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    index('commerce_outbox_status_next_idx').on(t.status, t.nextAttemptAt),
    check('commerce_outbox_attempts_nonneg', sql`${t.attempts} >= 0`),
  ],
)

/**
 * Настройки продаж, которые меняет администратор театра (политика возвратов и т.п.): ключ →
 * JSON, проверяемый доменом (`@/modules/refunds`). Не коллекция CMS: изменение пишет журнал аудита.
 */
export const commerceSettings = pgTable('commerce_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: updatedAt(),
})

/** Журнал аудита денежных и инвентарных операций. Без секретов, токенов и лишних ПД. */
export const commerceAuditLog = pgTable(
  'commerce_audit_log',
  {
    id: uuid('id').primaryKey(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    reason: text('reason'),
    result: text('result').notNull(),
    correlationId: text('correlation_id'),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('commerce_audit_log_entity_idx').on(t.entity, t.entityId, t.at),
    index('commerce_audit_log_at_idx').on(t.at),
  ],
)

export const commerceTables = {
  commerce_inventory: commerceInventory,
  commerce_orders: commerceOrders,
  commerce_seats: commerceSeats,
  commerce_holds: commerceHolds,
  commerce_order_items: commerceOrderItems,
  commerce_tickets: commerceTickets,
  commerce_payment_events: commercePaymentEvents,
  commerce_refunds: commerceRefunds,
  commerce_refund_tickets: commerceRefundTickets,
  commerce_outbox: commerceOutbox,
  commerce_settings: commerceSettings,
  commerce_audit_log: commerceAuditLog,
}
