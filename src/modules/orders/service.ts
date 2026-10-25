import { createHash, createHmac, randomInt as cryptoRandomInt, randomUUID } from 'node:crypto'

import {
  MAX_TICKETS_PER_ORDER,
  allocate,
  isSettled,
  transition,
  type OrderEvent,
  type OrderStatus,
} from '@/modules/checkout'
import { acquire, commit, release, type Unavailable } from '@/modules/inventory/inventory'
import { withRetry } from '@/modules/inventory/retry'
import type {
  CommerceStore,
  CommerceTx,
  OrderItemRow,
  OrderRow,
  TicketRow,
} from '@/modules/inventory/store'
import { CERTIFICATE_ALPHABET } from '@/modules/loyalty'

/**
 * Жизненный цикл заказа (T-040/T-042/T-048, architecture.md §8–§9). Только сервер. Каждая
 * операция — одна DB-транзакция с ограниченным повтором: оформление (заказ + позиции + бронь),
 * подтверждение оплаты (бронь → продажа + билеты + outbox), отмена, истечение брони и политика
 * поздней оплаты. Статус меняет только `transition` из `@/modules/checkout` условным UPDATE.
 *
 * Суммы приходят уже посчитанными сервером (`quoteOrder`/`quoteSeats` + `applyBonus` по данным
 * показа и кошелька) — здесь они проверяются на целостность и раскладываются по позициям
 * и билетам (`allocate`). Внешние вызовы (провайдер, письма) в транзакции не делаются.
 */

export const HOLD_TTL_MS = 15 * 60_000
/** Сколько ждать ответа провайдера по просроченной брони, прежде чем всё же её освободить. */
export const PENDING_PAYMENT_GRACE_MS = 10 * 60_000
const EXPIRE_BATCH = 100
const ORDER_NUMBER_LENGTH = 8
const TICKET_TOKEN_VERSION = 1

export type PlaceOrderLine = {
  performanceId: string
  /** Категория билета; для места — ценовая категория места. */
  ticketTypeId: string
  seatId?: string | null
  title: string
  unitPriceKopecks: number
  quantity: number
}

export type PlaceOrderInput = {
  /** Стабилен в пределах одной попытки оформления (повтор запроса — тот же ключ). */
  idempotencyKey: string
  email: string
  /** Из серверной сессии; гость — null. */
  customerId: string | null
  lines: PlaceOrderLine[]
  /** Сколько бонусов списывается (уже ограничено `applyBonus`). */
  bonusKopecks: number
  feePerTicketKopecks: number
  holdTtlMs?: number
  actor?: string
  correlationId?: string | null
}

export type OrderView = {
  order: OrderRow
  items: OrderItemRow[]
  tickets: TicketRow[]
}

export type PlaceOrderResult =
  | { ok: true; duplicate: boolean; order: OrderRow; items: OrderItemRow[] }
  | { ok: false; error: 'UNAVAILABLE'; unavailable: Unavailable[] }
  | { ok: false; error: 'IDEMPOTENCY_CONFLICT' }

export type ReviewReason = 'LATE_PAYMENT_NO_STOCK' | 'AMOUNT_MISMATCH' | 'CURRENCY_MISMATCH'

export type ConfirmPaymentInput = {
  orderId: string
  provider: string
  providerPaymentId: string
  /** Сумма и валюта — из авторитетного ответа провайдера (PAY-03), не из webhook/redirect. */
  amountKopecks: number
  currency: string
  actor?: string
  correlationId?: string | null
}

export type ConfirmPaymentResult =
  | { ok: true; status: 'PAID'; duplicate: boolean; late: boolean; tickets: TicketRow[] }
  | {
      ok: false
      error: 'NEEDS_REVIEW'
      reason: ReviewReason
      duplicate: boolean
      unavailable?: Unavailable[]
    }
  /** Оплата другим платежом уже оплаченного заказа — второй платёж нужно вернуть. */
  | { ok: false; error: 'DUPLICATE_PAYMENT' }
  | { ok: false; error: 'NOT_FOUND' }
  | { ok: false; error: 'INVALID_STATE'; status: OrderStatus }

/** Ответ провайдера по заказу при сверке перед истечением брони. */
export type PaymentCheck =
  | {
      status: 'succeeded'
      provider: string
      providerPaymentId: string
      amountKopecks: number
      currency: string
    }
  | { status: 'pending' }
  | { status: 'failed' }
  /** Платёж не создавался или ответ неизвестен. */
  | null

type Deps = {
  store: CommerceStore
  /** Секрет HMAC для QR-токенов билетов (из PAYLOAD_SECRET, метка 'turdus:ticket'). */
  ticketSecret: string
  randomInt?: (max: number) => number
  retry?: Parameters<typeof withRetry>[2]
}

const isKopecks = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Откат транзакции оформления: остатка не хватило. */
class UnavailableError extends Error {
  constructor(readonly unavailable: Unavailable[]) {
    super('inventory unavailable')
  }
}

class IdempotencyConflict extends Error {}

export function createOrderService({ store, ticketSecret, randomInt, retry }: Deps) {
  if (!ticketSecret) throw new Error('ticketSecret is required')
  const random = randomInt ?? ((max: number) => cryptoRandomInt(max))
  const run = <T>(fn: (tx: CommerceTx) => Promise<T>) => withRetry(store, fn, retry)

  const orderNumber = () => {
    let code = ''
    for (let i = 0; i < ORDER_NUMBER_LENGTH; i++)
      code += CERTIFICATE_ALPHABET[random(CERTIFICATE_ALPHABET.length)]
    return `TRD-${code}`
  }

  /** QR-токен билета: HMAC от id и версии; восстанавливается для повторного показа, в БД — хеш. */
  const ticketToken = (ticket: Pick<TicketRow, 'id' | 'tokenVersion'>) =>
    createHmac('sha256', ticketSecret)
      .update(`ticket:${ticket.id}:${ticket.tokenVersion}`)
      .digest('base64url')
  const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

  const audit = (
    tx: CommerceTx,
    row: {
      actor: string
      action: string
      entityId: string
      result: string
      reason?: string | null
    },
    at: Date,
    correlationId?: string | null,
  ) =>
    tx.insertAudit({
      id: randomUUID(),
      actor: row.actor,
      action: row.action,
      entity: 'order',
      entityId: row.entityId,
      reason: row.reason ?? null,
      result: row.result,
      correlationId: correlationId ?? null,
      at,
    })

  const enqueue = (tx: CommerceTx, kind: string, order: OrderRow, at: Date) =>
    tx.insertOutbox({
      id: randomUUID(),
      kind,
      dedupeKey: `${kind}:${order.id}`,
      aggregateId: order.id,
      // Без ПД: worker сам читает заказ по id.
      payload: { orderId: order.id, orderNumber: order.number },
      status: 'pending',
      attempts: 0,
      nextAttemptAt: at,
      lastError: null,
      createdAt: at,
      processedAt: null,
    })

  /** Применить переход state-machine условным UPDATE. Проигравший параллельный переход — ошибка. */
  const apply = async (
    tx: CommerceTx,
    order: OrderRow,
    event: OrderEvent,
    at: Date,
    extra: { paymentProvider?: string; providerPaymentId?: string } = {},
  ) => {
    const result = transition(order, event)
    if (!result.ok) throw new Error(`invalid order transition ${result.from} → ${result.event}`)
    if ('noop' in result) return order
    const set = { status: result.to, ...result.patch, ...extra }
    if (!(await tx.updateOrder(order.id, result.from, set, at)))
      throw new Error('order changed concurrently')
    return { ...order, ...set, updatedAt: at }
  }

  /** Билеты по позициям: доля бонусов и сбора каждого — `allocate` от позиции. */
  const issueTickets = async (tx: CommerceTx, order: OrderRow, items: OrderItemRow[], at: Date) => {
    const rows: TicketRow[] = []
    let n = 0
    for (const item of [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const bonus = allocate(
        item.lineBonusKopecks,
        Array(item.quantity).fill(item.unitPriceKopecks),
      )
      const fee = allocate(item.lineFeeKopecks, Array(item.quantity).fill(1))
      for (let i = 0; i < item.quantity; i++) {
        n += 1
        const id = randomUUID()
        rows.push({
          id,
          number: `${order.number}-${String(n).padStart(2, '0')}`,
          orderId: order.id,
          orderItemId: item.id,
          performanceId: item.performanceId,
          ticketTypeId: item.ticketTypeId,
          seatId: item.seatId,
          tokenHash: tokenHash(ticketToken({ id, tokenVersion: TICKET_TOKEN_VERSION })),
          tokenVersion: TICKET_TOKEN_VERSION,
          status: 'ISSUED',
          priceKopecks: item.unitPriceKopecks,
          bonusKopecks: bonus[i]!,
          cashKopecks: item.unitPriceKopecks - bonus[i]!,
          feeKopecks: fee[i]!,
          issuedAt: at,
          refundedAt: null,
        })
      }
    }
    await tx.insertTickets(rows)
    return rows
  }

  const requestHash = (input: PlaceOrderInput, lines: PlaceOrderLine[]) =>
    createHash('sha256')
      .update(
        JSON.stringify({
          email: input.email,
          customerId: input.customerId,
          bonus: input.bonusKopecks,
          fee: input.feePerTicketKopecks,
          lines: lines
            .map((l) => [
              l.performanceId,
              l.ticketTypeId,
              l.seatId ?? null,
              l.unitPriceKopecks,
              l.quantity,
            ])
            .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
        }),
      )
      .digest('hex')

  /**
   * Оформление: заказ PENDING_PAYMENT, позиции со снимком цены и долей бонусов, бронь на 15 минут —
   * атомарно. Нет остатка — ничего не создаётся (UNAVAILABLE со списком). Повтор с тем же ключом
   * возвращает тот же заказ; тот же ключ с другим составом — IDEMPOTENCY_CONFLICT.
   */
  async function placeOrder(input: PlaceOrderInput, now = new Date()): Promise<PlaceOrderResult> {
    const key = input.idempotencyKey?.trim()
    if (!key || key.length > 200) throw new RangeError('idempotencyKey is required')
    const email = input.email?.trim().toLowerCase()
    if (!email || email.length > 254) throw new RangeError('email is required')
    if (!isKopecks(input.bonusKopecks)) throw new RangeError('bonusKopecks must be integer kopecks')
    if (!isKopecks(input.feePerTicketKopecks))
      throw new RangeError('feePerTicketKopecks must be integer kopecks')
    const ttl = input.holdTtlMs ?? HOLD_TTL_MS
    if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new RangeError('holdTtlMs must be positive')
    if (!input.lines.length) throw new RangeError('order has no lines')
    const lines = input.lines.map((l) => ({ ...l, seatId: l.seatId ?? null }))
    for (const l of lines) {
      if (!l.performanceId || !l.ticketTypeId || !l.title) throw new RangeError('incomplete line')
      if (!isKopecks(l.unitPriceKopecks)) throw new RangeError('unitPriceKopecks must be kopecks')
      if (!Number.isSafeInteger(l.quantity) || l.quantity <= 0)
        throw new RangeError('quantity must be a positive integer')
      if (l.seatId !== null && l.quantity !== 1)
        throw new RangeError('seat line must have quantity 1')
    }
    const ticketCount = lines.reduce((sum, l) => sum + l.quantity, 0)
    if (ticketCount > MAX_TICKETS_PER_ORDER) throw new RangeError('too many tickets')
    const grosses = lines.map((l) => l.unitPriceKopecks * l.quantity)
    const gross = grosses.reduce((sum, g) => sum + g, 0)
    const fee = input.feePerTicketKopecks * ticketCount
    if (!Number.isSafeInteger(gross) || !Number.isSafeInteger(gross + fee))
      throw new RangeError('order total overflow')
    if (input.bonusKopecks > gross) throw new RangeError('bonus exceeds tickets total')
    const bonusShares = gross > 0 ? allocate(input.bonusKopecks, grosses) : grosses.map(() => 0)
    const hash = requestHash({ ...input, email }, lines)
    const holdUntil = new Date(now.getTime() + ttl)
    const actor = input.actor ?? 'customer'

    try {
      return await run<PlaceOrderResult>(async (tx) => {
        const pending = transition({ status: 'DRAFT' }, { type: 'HOLD_PLACED', holdUntil })
        if (!pending.ok || 'noop' in pending) throw new Error('state machine rejected HOLD_PLACED')
        const order: OrderRow = {
          id: randomUUID(),
          number: '',
          customerId: input.customerId,
          email,
          status: pending.to,
          grossKopecks: gross,
          bonusKopecks: input.bonusKopecks,
          feeKopecks: fee,
          cashKopecks: gross - input.bonusKopecks + fee,
          currency: 'RUB',
          holdUntil,
          idempotencyKey: key,
          requestHash: hash,
          paymentProvider: null,
          providerPaymentId: null,
          reviewReason: null,
          paidAt: null,
          closedAt: null,
          createdAt: now,
          updatedAt: now,
        }
        // Сначала ключ: параллельный повтор того же оформления ждёт на уникальном индексе.
        for (let attempt = 0; ; attempt++) {
          if (attempt === 5) throw new Error('order number allocation failed')
          order.number = orderNumber()
          if (await tx.insertOrder(order)) break
          const existing = await tx.findOrderByKey(key)
          if (existing) {
            if (existing.requestHash !== hash) throw new IdempotencyConflict()
            return {
              ok: true,
              duplicate: true,
              order: existing,
              items: await tx.listItems(existing.id),
            }
          }
          // Совпал номер заказа — новый номер.
        }
        const items: OrderItemRow[] = lines.map((l, i) => ({
          id: randomUUID(),
          orderId: order.id,
          performanceId: l.performanceId,
          ticketTypeId: l.ticketTypeId,
          seatId: l.seatId,
          titleSnapshot: l.title,
          unitPriceKopecks: l.unitPriceKopecks,
          quantity: l.quantity,
          lineGrossKopecks: grosses[i]!,
          lineBonusKopecks: bonusShares[i]!,
          lineCashKopecks: grosses[i]! - bonusShares[i]!,
          lineFeeKopecks: input.feePerTicketKopecks * l.quantity,
        }))
        // Порядок важен: сначала бронь и блокировка остатков/мест, потом позиции — вставка
        // позиции со ссылкой на место берёт KEY SHARE на место (см. CommerceTx.lockInventory).
        const holdId = randomUUID()
        await tx.insertHold({
          id: holdId,
          orderId: order.id,
          status: 'ACTIVE',
          expiresAt: holdUntil,
          createdAt: now,
          closedAt: null,
        })
        const taken = await acquire(tx, items, { kind: 'hold', holdId, orderId: order.id }, now)
        if (!taken.ok) throw new UnavailableError(taken.unavailable)
        await tx.insertItems(items)
        await audit(
          tx,
          { actor, action: 'order.placed', entityId: order.id, result: 'PENDING_PAYMENT' },
          now,
          input.correlationId,
        )
        return { ok: true, duplicate: false, order, items }
      })
    } catch (error) {
      if (error instanceof UnavailableError)
        return { ok: false, error: 'UNAVAILABLE', unavailable: error.unavailable }
      if (error instanceof IdempotencyConflict) return { ok: false, error: 'IDEMPOTENCY_CONFLICT' }
      throw error
    }
  }

  /** Освободить активную бронь заказа (отмена, истечение, неверная сумма). */
  const releaseHold = async (
    tx: CommerceTx,
    order: OrderRow,
    to: 'RELEASED' | 'EXPIRED',
    at: Date,
  ) => {
    const hold = await tx.lockHold(order.id)
    if (!hold || hold.status !== 'ACTIVE') throw new Error('pending order without active hold')
    await release(tx, await tx.listItems(order.id), hold.id, at)
    if (!(await tx.closeHold(hold.id, to, at))) throw new Error('hold changed concurrently')
  }

  /**
   * Подтверждённая провайдером оплата (вызывает обработчик webhook/сверки после проверки
   * платежа у провайдера). Идемпотентна: повтор не выпускает второй комплект билетов.
   *
   * - PENDING_PAYMENT: бронь → продажа, билеты, PAID, письмо в outbox.
   * - EXPIRED/CANCELLED (поздняя оплата, бронь уже освобождена): остаток берётся заново атомарно;
   *   хватило — PAID и билеты; нет — NEEDS_REVIEW и задача на полный возврат (PRD §5.3,
   *   TICKETS-07). Вместимость не превышается ни в одном случае.
   * - Сумма или валюта не совпали с заказом — билетов нет, NEEDS_REVIEW, бронь освобождается.
   */
  async function confirmPayment(
    input: ConfirmPaymentInput,
    now = new Date(),
  ): Promise<ConfirmPaymentResult> {
    if (!input.provider || !input.providerPaymentId) throw new RangeError('payment id is required')
    if (!Number.isSafeInteger(input.amountKopecks)) throw new RangeError('amount must be kopecks')
    const actor = input.actor ?? `provider:${input.provider}`
    const payment = { paymentProvider: input.provider, providerPaymentId: input.providerPaymentId }

    return run<ConfirmPaymentResult>(async (tx) => {
      const order = await tx.lockOrder(input.orderId)
      if (!order) return { ok: false, error: 'NOT_FOUND' }
      const samePayment =
        order.providerPaymentId === null ||
        (order.paymentProvider === input.provider &&
          order.providerPaymentId === input.providerPaymentId)

      if (isSettled(order.status) || order.status === 'NEEDS_REVIEW') {
        if (!samePayment) {
          if (await enqueue(tx, 'payment.duplicate', order, now))
            await audit(
              tx,
              { actor, action: 'payment.duplicate', entityId: order.id, result: order.status },
              now,
              input.correlationId,
            )
          return { ok: false, error: 'DUPLICATE_PAYMENT' }
        }
        if (order.status === 'NEEDS_REVIEW')
          return {
            ok: false,
            error: 'NEEDS_REVIEW',
            reason: (order.reviewReason as ReviewReason) ?? 'LATE_PAYMENT_NO_STOCK',
            duplicate: true,
          }
        // Повтор webhook/сверки: билеты уже выпущены этой же оплатой — вернуть их.
        return {
          ok: true,
          status: 'PAID',
          duplicate: true,
          late: false,
          tickets: await tx.listTickets(order.id),
        }
      }
      if (
        order.status !== 'PENDING_PAYMENT' &&
        order.status !== 'EXPIRED' &&
        order.status !== 'CANCELLED'
      )
        return { ok: false, error: 'INVALID_STATE', status: order.status }

      const review = async (reason: ReviewReason, unavailable?: Unavailable[]) => {
        if (order.status === 'PENDING_PAYMENT') await releaseHold(tx, order, 'RELEASED', now)
        const flagged = await apply(
          tx,
          order,
          { type: 'REVIEW_REQUIRED', at: now, reason },
          now,
          payment,
        )
        await enqueue(tx, 'order.needs_review', flagged, now)
        await audit(
          tx,
          {
            actor,
            action: 'order.needs_review',
            entityId: order.id,
            result: 'NEEDS_REVIEW',
            reason,
          },
          now,
          input.correlationId,
        )
        return {
          ok: false as const,
          error: 'NEEDS_REVIEW' as const,
          reason,
          duplicate: false,
          unavailable,
        }
      }
      if (input.currency !== order.currency) return review('CURRENCY_MISMATCH')
      if (input.amountKopecks !== order.cashKopecks) return review('AMOUNT_MISMATCH')

      const items = await tx.listItems(order.id)
      let late = false
      if (order.status === 'PENDING_PAYMENT') {
        // Бронь на месте, даже если её срок прошёл, а worker ещё не дошёл: продаём из брони.
        const hold = await tx.lockHold(order.id)
        if (!hold || hold.status !== 'ACTIVE') throw new Error('pending order without active hold')
        await commit(tx, items, hold.id, order.id, now)
        if (!(await tx.closeHold(hold.id, 'COMMITTED', now)))
          throw new Error('hold changed concurrently')
      } else {
        late = true
        const taken = await acquire(tx, items, { kind: 'sell', orderId: order.id }, now)
        if (!taken.ok) return review('LATE_PAYMENT_NO_STOCK', taken.unavailable)
      }
      const paid = await apply(
        tx,
        order,
        late ? { type: 'LATE_PAYMENT_ALLOCATED', at: now } : { type: 'PAYMENT_CONFIRMED', at: now },
        now,
        payment,
      )
      const tickets = await issueTickets(tx, paid, items, now)
      await enqueue(tx, 'order.paid', paid, now)
      await audit(
        tx,
        {
          actor,
          action: late ? 'order.late_payment_allocated' : 'order.paid',
          entityId: order.id,
          result: 'PAID',
        },
        now,
        input.correlationId,
      )
      return { ok: true, status: 'PAID', duplicate: false, late, tickets }
    })
  }

  /** Отмена неоплаченного заказа (зритель, провайдер сообщил об отмене платежа, касса). */
  async function cancelOrder(
    orderId: string,
    { actor, reason }: { actor: string; reason: string },
    now = new Date(),
  ) {
    return run(async (tx) => {
      const order = await tx.lockOrder(orderId)
      if (!order) return { ok: false as const, error: 'NOT_FOUND' as const }
      const result = transition(order, { type: 'CANCELLED', at: now })
      if (!result.ok)
        return { ok: false as const, error: 'INVALID_STATE' as const, status: order.status }
      if ('noop' in result) return { ok: true as const, duplicate: true }
      if (order.status === 'PENDING_PAYMENT') await releaseHold(tx, order, 'RELEASED', now)
      await apply(tx, order, { type: 'CANCELLED', at: now }, now)
      await audit(
        tx,
        { actor, action: 'order.cancelled', entityId: order.id, result: 'CANCELLED', reason },
        now,
      )
      return { ok: true as const, duplicate: false }
    })
  }

  /** Истечение одного заказа под блокировкой; уже обработанный/оплаченный — пропуск. */
  const expireLocked = async (tx: CommerceTx, order: OrderRow, now: Date) => {
    if (order.status !== 'PENDING_PAYMENT' || !order.holdUntil || order.holdUntil > now)
      return false
    await releaseHold(tx, order, 'EXPIRED', now)
    await apply(tx, order, { type: 'HOLD_EXPIRED', at: now }, now)
    await audit(
      tx,
      { actor: 'worker', action: 'order.expired', entityId: order.id, result: 'EXPIRED' },
      now,
    )
    return true
  }

  /**
   * Истечение броней (worker, T-048). Идемпотентно и безопасно при нескольких экземплярах
   * worker (SKIP LOCKED). С `verify` — сначала сверка с провайдером вне транзакции (PRD §5.3):
   * оплачен — подтверждаем оплату вместо освобождения; «в процессе» — ждём до `pendingGraceMs`
   * после конца брони; иначе освобождаем. Поздняя оплата после освобождения безопасна:
   * `confirmPayment` выделит остаток заново или отправит заказ на разбор.
   */
  async function expireHolds(
    now = new Date(),
    {
      /** Сколько заказов обработать за вызов (worker вызывает периодически). */
      limit = EXPIRE_BATCH,
      verify,
      pendingGraceMs = PENDING_PAYMENT_GRACE_MS,
    }: {
      limit?: number
      verify?: (order: OrderRow) => Promise<PaymentCheck>
      pendingGraceMs?: number
    } = {},
  ) {
    let expired = 0
    let confirmed = 0
    let skipped = 0
    if (!verify) {
      // Один заказ — одна транзакция: пачка заказов в одной транзакции блокировала бы остатки
      // в порядке заказов, а не в общем порядке, и сцеплялась бы с соседним worker в deadlock.
      for (let n = 0; n < limit; n++) {
        const claimed = await run(async (tx) => {
          const [order] = await tx.claimExpired(now, 1)
          if (!order) return null
          return expireLocked(tx, order, now)
        })
        if (claimed === null) break
        if (claimed) expired++
      }
      return { expired, confirmed, skipped }
    }
    for (const candidate of await store.overdueOrders(now, limit)) {
      let check: PaymentCheck = null
      try {
        check = await verify(candidate)
      } catch {
        check = { status: 'pending' } // провайдер недоступен — как «неизвестно, ждём»
      }
      if (check?.status === 'succeeded') {
        const result = await confirmPayment(
          {
            orderId: candidate.id,
            provider: check.provider,
            providerPaymentId: check.providerPaymentId,
            amountKopecks: check.amountKopecks,
            currency: check.currency,
            actor: 'worker',
          },
          now,
        )
        if (result.ok) confirmed++
        else skipped++
        continue
      }
      const overdueMs = now.getTime() - (candidate.holdUntil?.getTime() ?? now.getTime())
      if (check?.status === 'pending' && overdueMs < pendingGraceMs) {
        skipped++
        continue
      }
      const done = await run(async (tx) => {
        const order = await tx.lockOrder(candidate.id)
        return order ? expireLocked(tx, order, now) : false
      })
      if (done) expired++
      else skipped++
    }
    return { expired, confirmed, skipped }
  }

  /** Сохранить уведомление провайдера с дедупликацией (at-least-once). */
  async function recordPaymentEvent(
    event: {
      provider: string
      providerPaymentId: string
      eventId: string
      eventType: string
      orderId?: string | null
      /** Минимум: статус, сумма, валюта. Без карточных данных и секретов. */
      payload: Record<string, unknown>
      correlationId?: string | null
    },
    now = new Date(),
  ) {
    if (!event.provider || !event.eventId) throw new RangeError('provider and eventId are required')
    const inserted = await run((tx) =>
      tx.insertPaymentEvent({
        id: randomUUID(),
        provider: event.provider,
        providerPaymentId: event.providerPaymentId,
        eventId: event.eventId,
        orderId: event.orderId ?? null,
        eventType: event.eventType,
        payload: event.payload,
        correlationId: event.correlationId ?? null,
        receivedAt: now,
        processedAt: null,
        result: null,
      }),
    )
    return { duplicate: !inserted }
  }

  /** Заказ с позициями и билетами (без блокировок; доступ проверяет вызывающий). */
  async function getOrder(id: string): Promise<OrderView | null> {
    const order = await store.order(id)
    if (!order) return null
    const [items, tickets] = await Promise.all([store.items(id), store.tickets(id)])
    return { order, items, tickets }
  }

  return {
    placeOrder,
    confirmPayment,
    cancelOrder,
    expireHolds,
    recordPaymentEvent,
    getOrder,
    ticketToken,
  }
}

export type OrderService = ReturnType<typeof createOrderService>
