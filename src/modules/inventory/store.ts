import type { OrderPatch, OrderStatus } from '@/modules/checkout'

/**
 * Контракт хранилища транзакционного ядра продаж (T-040/T-042): PostgreSQL (`pgStore.ts`) или
 * память для тестов и dev (`memoryStore.ts`). Доменная логика — в `inventory.ts` и
 * `@/modules/orders`; хранилище только выполняет условные операции и блокирует строки.
 *
 * Порядок блокировок во всех операциях один: строка заказа → строки остатков (по показу, затем
 * категории) → места (по показу, затем месту). Так параллельные резервы, оплаты и истечения не
 * взаимоблокируются; редкий deadlock/serialization failure повторяет `withRetry`.
 */

export type InventoryKey = { performanceId: string; ticketTypeId: string }

export type InventoryRow = InventoryKey & {
  capacity: number
  sold: number
  held: number
  updatedAt: Date
}

export type SeatStatus = 'free' | 'held' | 'sold' | 'blocked'

export type SeatRow = {
  performanceId: string
  seatId: string
  planId: string
  planVersion: number
  categoryId: string
  status: SeatStatus
  holdId: string | null
  orderId: string | null
  updatedAt: Date
}

export type HoldStatus = 'ACTIVE' | 'COMMITTED' | 'RELEASED' | 'EXPIRED'

export type HoldRow = {
  id: string
  orderId: string
  status: HoldStatus
  expiresAt: Date
  createdAt: Date
  closedAt: Date | null
}

export type OrderRow = {
  id: string
  number: string
  customerId: string | null
  email: string
  status: OrderStatus
  grossKopecks: number
  bonusKopecks: number
  feeKopecks: number
  cashKopecks: number
  currency: 'RUB'
  holdUntil: Date | null
  idempotencyKey: string
  requestHash: string
  paymentProvider: string | null
  providerPaymentId: string | null
  reviewReason: string | null
  paidAt: Date | null
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type OrderItemRow = {
  id: string
  orderId: string
  performanceId: string
  ticketTypeId: string
  seatId: string | null
  titleSnapshot: string
  /** Снимок показа на момент оформления; у позиций до снимков — null (берётся из афиши). */
  showTitleSnapshot: string | null
  showSlugSnapshot: string | null
  startsAtSnapshot: Date | null
  venueTitleSnapshot: string | null
  venueAddressSnapshot: string | null
  unitPriceKopecks: number
  quantity: number
  lineGrossKopecks: number
  lineBonusKopecks: number
  lineCashKopecks: number
  lineFeeKopecks: number
}

export type TicketStatus = 'ISSUED' | 'REFUND_PENDING' | 'REFUNDED'

export type TicketRow = {
  id: string
  number: string
  orderId: string
  orderItemId: string
  performanceId: string
  ticketTypeId: string
  seatId: string | null
  tokenHash: string
  tokenVersion: number
  status: TicketStatus
  priceKopecks: number
  bonusKopecks: number
  cashKopecks: number
  feeKopecks: number
  issuedAt: Date
  refundedAt: Date | null
}

export type OutboxRow = {
  id: string
  kind: string
  dedupeKey: string
  aggregateId: string
  payload: Record<string, unknown>
  status: 'pending' | 'processing' | 'done' | 'dead'
  attempts: number
  nextAttemptAt: Date
  lastError: string | null
  createdAt: Date
  processedAt: Date | null
}

export type AuditRow = {
  id: string
  actor: string
  action: string
  entity: string
  entityId: string
  reason: string | null
  result: string
  correlationId: string | null
  at: Date
}

export type PaymentEventRow = {
  id: string
  provider: string
  providerPaymentId: string
  eventId: string
  orderId: string | null
  eventType: string
  payload: Record<string, unknown>
  correlationId: string | null
  receivedAt: Date
  processedAt: Date | null
  result: string | null
}

export type RefundStatus = 'REQUESTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'MANUAL_REVIEW'

export type RefundRow = {
  id: string
  orderId: string
  status: RefundStatus
  kind: 'customer' | 'staff'
  /** Вся сумма на карту, включая возвращаемый сервисный сбор. */
  cashKopecks: number
  /** Потраченные бонусы, которые вернутся на счёт. */
  bonusKopecks: number
  /** Часть `cashKopecks`, приходящаяся на сервисный сбор. */
  feeKopecks: number
  /** Сторно начисленных бонусов (после компенсации). */
  bonusReversalKopecks: number
  idempotencyKey: string
  provider: string | null
  providerRefundId: string | null
  providerStatus: string | null
  attempts: number
  nextAttemptAt: Date | null
  lastError: string | null
  reason: string
  requestedBy: string
  correlationId: string | null
  completedAt: Date | null
  bonusSettledAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type RefundTicketRow = {
  refundId: string
  ticketId: string
  cashKopecks: number
  bonusKopecks: number
  feeKopecks: number
  voidedAt: Date | null
}

/** Изменяемые поля возврата (статус — только через state-machine `@/modules/refunds`). */
export type RefundUpdate = Partial<
  Pick<
    RefundRow,
    | 'status'
    | 'providerRefundId'
    | 'providerStatus'
    | 'attempts'
    | 'nextAttemptAt'
    | 'lastError'
    | 'completedAt'
    | 'bonusReversalKopecks'
    | 'bonusSettledAt'
  >
>

export type SettingRow = { key: string; value: unknown; updatedBy: string; updatedAt: Date }

/** Изменение заказа при переходе статуса (вычисляет `transition`). */
export type OrderUpdate = OrderPatch & {
  status: OrderStatus
  paymentProvider?: string
  providerPaymentId?: string
}

/** Операции одной DB-транзакции (READ COMMITTED + явные блокировки). Ошибка — откат всего. */
export interface CommerceTx {
  /**
   * Существующие строки остатков, заблокированные (FOR NO KEY UPDATE) в порядке (показ, категория).
   * Строки, на которые будут ссылаться новые строки (места ← позиции, билеты), блокируются ДО
   * вставки ссылающихся строк: иначе KEY SHARE от FK и блокировка строки сцепляются в deadlock.
   */
  lockInventory(keys: InventoryKey[]): Promise<InventoryRow[]>
  /** false — строка уже есть. */
  insertInventory(row: InventoryRow): Promise<boolean>
  /**
   * Условно изменить held/sold на дельты: только если после изменения оба >= 0 и
   * `sold + held <= capacity`. true — изменили.
   */
  adjustInventory(
    key: InventoryKey,
    delta: { held: number; sold: number },
    at: Date,
  ): Promise<boolean>
  /** Новая вместимость — только если она не ниже `sold + held`. */
  setCapacity(key: InventoryKey, capacity: number, at: Date): Promise<boolean>

  /** Места показа, заблокированные FOR UPDATE в порядке id; `seatIds` не задан — все места. */
  lockSeats(performanceId: string, seatIds?: string[]): Promise<SeatRow[]>
  /** Добавить места; уже существующие не меняются. */
  insertSeats(rows: SeatRow[]): Promise<void>
  /**
   * Условно перевести места: только строки, совпадающие с `where`. Возвращает число
   * изменённых строк — вызывающий сверяет его с числом мест.
   */
  updateSeats(
    performanceId: string,
    seatIds: string[],
    where: { status: SeatStatus; holdId?: string; orderId?: string },
    set: { status: SeatStatus; holdId: string | null; orderId: string | null },
    at: Date,
  ): Promise<number>
  /** Обновить категорию/версию схемы свободного или закрытого места (синхронизация схемы). */
  retagSeat(
    performanceId: string,
    seatId: string,
    set: { planId: string; planVersion: number; categoryId: string },
    at: Date,
  ): Promise<boolean>

  insertHold(row: HoldRow): Promise<void>
  /** Бронь заказа под блокировкой. */
  lockHold(orderId: string): Promise<HoldRow | null>
  /** Условный переход ACTIVE → COMMITTED | RELEASED | EXPIRED. */
  closeHold(id: string, to: Exclude<HoldStatus, 'ACTIVE'>, at: Date): Promise<boolean>

  /** false — конфликт уникальности (ключ идемпотентности или номер заказа). */
  insertOrder(row: OrderRow): Promise<boolean>
  findOrderByKey(idempotencyKey: string): Promise<OrderRow | null>
  lockOrder(id: string): Promise<OrderRow | null>
  /**
   * Заказы PENDING_PAYMENT с истёкшей бронью, заблокированные FOR UPDATE SKIP LOCKED: несколько
   * экземпляров worker не берут один заказ, а занятый оплатой заказ пропускается.
   */
  claimExpired(now: Date, limit: number): Promise<OrderRow[]>
  /** Условный переход: только если статус всё ещё `from`. */
  updateOrder(id: string, from: OrderStatus, set: OrderUpdate, at: Date): Promise<boolean>
  insertItems(rows: OrderItemRow[]): Promise<void>
  listItems(orderId: string): Promise<OrderItemRow[]>
  listTickets(orderId: string): Promise<TicketRow[]>
  insertTickets(rows: TicketRow[]): Promise<void>
  /** false — событие с таким `dedupeKey` уже есть. */
  insertOutbox(row: OutboxRow): Promise<boolean>
  insertAudit(row: AuditRow): Promise<void>
  /** false — событие провайдера с таким `eventId` уже записано. */
  insertPaymentEvent(row: PaymentEventRow): Promise<boolean>

  // --- Возвраты (T-052/T-053, `@/modules/refunds`). Порядок блокировок: заказ → возврат → билеты
  // → остатки → места — тот же, что у оплаты (заказ первым).

  /** Билеты заказа под блокировкой (FOR NO KEY UPDATE) в порядке id. */
  lockTickets(orderId: string): Promise<TicketRow[]>
  /** Условно сменить статус билетов: только строки в статусе `from`. Возвращает число изменённых. */
  updateTickets(
    ids: string[],
    from: TicketStatus,
    set: { status: TicketStatus; refundedAt: Date | null },
  ): Promise<number>
  /** false — возврат с таким ключом идемпотентности уже есть. */
  insertRefund(row: RefundRow): Promise<boolean>
  findRefundByKey(idempotencyKey: string): Promise<RefundRow | null>
  lockRefund(id: string): Promise<RefundRow | null>
  /** Условное изменение: только если статус всё ещё `from`. */
  updateRefund(id: string, from: RefundStatus, set: RefundUpdate, at: Date): Promise<boolean>
  /**
   * Доли билетов возврата. false — у какого-то билета уже есть живой (не аннулированный) возврат:
   * частичный уникальный индекс `commerce_refund_tickets_live_uq` (параллельная вставка того же
   * билета ждёт чужую транзакцию). Вставка могла пройти частично — вызывающий откатывает транзакцию.
   */
  insertRefundTickets(rows: RefundTicketRow[]): Promise<boolean>
  listRefundTickets(refundId: string): Promise<RefundTicketRow[]>
  /** Аннулировать доли неудавшегося возврата — билеты снова можно вернуть. */
  voidRefundTickets(refundId: string, at: Date): Promise<void>
  /** Живой возврат, в который входит билет (для ответа на повторный запрос). */
  liveRefundOfTicket(ticketId: string): Promise<RefundRow | null>
  upsertSetting(row: SettingRow): Promise<void>
}

export interface CommerceStore {
  transaction<T>(fn: (tx: CommerceTx) => Promise<T>): Promise<T>
  /** Ошибка, после которой транзакцию можно повторить целиком (deadlock, serialization). */
  isRetryable(error: unknown): boolean
  inventory(performanceId: string): Promise<InventoryRow[]>
  seats(performanceId: string): Promise<SeatRow[]>
  order(id: string): Promise<OrderRow | null>
  /** Заказы PENDING_PAYMENT с истёкшей бронью, без блокировки (сверка с провайдером до истечения). */
  overdueOrders(now: Date, limit: number): Promise<OrderRow[]>
  /**
   * Заказы в статусах `statuses`, изменённые не раньше `updatedSince`, старые первыми, без
   * блокировки — для сверки платежей и компенсаций (`@/modules/payments`, повторы идемпотентны).
   */
  ordersInStatus(statuses: OrderStatus[], updatedSince: Date, limit: number): Promise<OrderRow[]>
  items(orderId: string): Promise<OrderItemRow[]>
  tickets(orderId: string): Promise<TicketRow[]>
  /** Заказ по номеру TRD-XXXXXXXX (касса ищет заказ для возврата). */
  orderByNumber(number: string): Promise<OrderRow | null>
  /** Билет по номеру (без блокировки) — поиск заказа для возврата. */
  ticketByNumber(number: string): Promise<TicketRow | null>
  refund(id: string): Promise<RefundRow | null>
  refundsOfOrder(orderId: string): Promise<RefundRow[]>
  refundTickets(refundId: string): Promise<RefundTicketRow[]>
  /** Возвраты в статусах, которым пора к банку (`next_attempt_at <= now`), старые первыми. */
  refundsDue(statuses: RefundStatus[], now: Date, limit: number): Promise<RefundRow[]>
  /** Успешные возвраты без компенсации бонусов (шаг после успеха не дошёл). */
  refundsUnsettled(limit: number): Promise<RefundRow[]>
  /** Последние возвраты (админка), новые первыми. */
  recentRefunds(limit: number): Promise<RefundRow[]>
  setting(key: string): Promise<SettingRow | null>
}
