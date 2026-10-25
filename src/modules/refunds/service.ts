import { randomUUID } from 'node:crypto'

import { ALERTS, errorInfo, type Logger } from '@/lib/log'
import { transition, type OrderEvent } from '@/modules/checkout'
import { returnSold } from '@/modules/inventory/inventory'
import { withRetry } from '@/modules/inventory/retry'
import type {
  CommerceStore,
  CommerceTx,
  OrderRow,
  RefundRow,
  RefundStatus,
  RefundUpdate,
  TicketRow,
} from '@/modules/inventory/store'
import {
  PaymentProviderError,
  callProvider,
  type CallOptions,
  type PaymentProvider,
  type ProviderRefund,
} from '@/modules/payments'
import type { WalletService } from '@/modules/wallet/service'

import { refundAmounts, reversalShare, type RefundAmounts } from './amounts'
import {
  REFUND_POLICY_KEY,
  customerRefundBlock,
  parseRefundPolicy,
  refundPolicySchema,
  type CustomerRefundBlock,
  type RefundPolicy,
} from './policy'
import { isFinalRefund, publicRefundStatus, refundTransition, type RefundEvent } from './state'

/**
 * Возвраты (T-052, T-053, T-064; PRD §5.4, architecture.md §10). Только сервер. Склеивает заказ,
 * билеты, остатки, кошелёк и `PaymentProvider`, не держа DB-транзакцию во время обращения к банку:
 *
 *   1. открытие (транзакция): заказ под блокировкой → правила (повторно, под блокировкой) →
 *      возврат REQUESTED + доли билетов (частичный уникальный индекс: один живой возврат на
 *      билет) → билеты ISSUED → REFUND_PENDING → аудит;
 *   2. банк (вне транзакции): `refund` с ключом `refund:<refundId>` — повтор, сверка и
 *      параллельный вызов не вернут деньги дважды;
 *   3. итог (транзакция): SUCCEEDED → билеты REFUNDED, остаток в продажу (по политике), заказ
 *      PARTIALLY_REFUNDED/REFUNDED через `transition`, outbox `refund.succeeded`, аудит;
 *      FAILED → доли аннулируются, билеты снова ISSUED; неизвестный исход — статус прежний,
 *      сверка (`reconcile`, worker) повторяет с тем же ключом, после лимита — MANUAL_REVIEW;
 *   4. бонусы (после успеха, идемпотентно): сторно начисления и возврат потраченных
 *      (`wallet.compensateRefund`); заказ возвращён целиком — друг по «Приведи 3 друга» снимается
 *      со счётчика, если награда за его тройку ещё не выдана (T-062); отметка `bonus_settled_at`;
 *      не дошло — доделает сверка.
 */

/** Сколько раз спрашивать банк при неизвестном исходе, прежде чем отдать возврат человеку. */
export const MAX_UNKNOWN_ATTEMPTS = 8
/** Сколько ждать возврат «в обработке» у банка, прежде чем отдать человеку. */
export const PENDING_REVIEW_AFTER_MS = 72 * 60 * 60_000
const RECONCILE_BATCH = 100
const RECENT_LIMIT = 50
const CLIENT_KEY = /^[A-Za-z0-9-]{16,100}$/
const MAX_TICKETS = 20
const REASON_MAX = 500

/** Пауза до следующей попытки: 1, 2, 4… минут, не больше часа. */
export const retryDelayMs = (attempts: number) =>
  Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1))

export type RefundActor =
  | { kind: 'customer'; customerId: string }
  /** Сотрудник CMS (кассир/администратор); роль проверяет вызывающий (access layer). */
  | { kind: 'staff'; staffId: string; email?: string | null; role: string }

export type RefundSummary = {
  id: string
  orderId: string
  orderNumber: string
  status: RefundStatus
  publicStatus: ReturnType<typeof publicRefundStatus>
  kind: RefundRow['kind']
  cashKopecks: number
  bonusKopecks: number
  feeKopecks: number
  bonusReversalKopecks: number
  ticketNumbers: string[]
  reason: string
  requestedBy: string
  providerStatus: string | null
  lastError: string | null
  attempts: number
  createdAt: Date
  completedAt: Date | null
  bonusSettledAt: Date | null
}

export type RefundError =
  | 'NOT_FOUND'
  | 'INVALID_KEY'
  | 'INVALID_REASON'
  /** У билета уже есть живой возврат (повторный клик/параллельный запрос). */
  | 'IN_PROGRESS'
  /** Билет не действует или заказ не в оплаченном статусе. */
  | 'NOT_REFUNDABLE'
  | 'NOTHING_TO_REFUND'
  /** Тот же ключ с другим составом. */
  | 'IDEMPOTENCY_CONFLICT'
  /** Возврат денег невозможен: банк не подключён или платёж заказа неизвестен. */
  | 'PAYMENT_UNAVAILABLE'
  /** Правила театра не позволяют зрителю вернуть сам (`block`). */
  | 'BLOCKED'

export type RefundRequestResult =
  | { ok: true; duplicate: boolean; refund: RefundSummary }
  | {
      ok: false
      error: RefundError
      block?: CustomerRefundBlock
      /** Для IN_PROGRESS — уже идущий возврат. */
      refund?: RefundSummary
    }

/** Предпросмотр возврата зрителем: что и сколько вернётся, можно ли сейчас. */
export type CustomerRefundQuote = {
  orderNumber: string
  /** Билеты, которые войдут в возврат (при запрете частичного — все оставшиеся заказа). */
  ticketNumbers: string[]
  /** Остальные билеты заказа, которые ещё можно вернуть. */
  otherRefundable: string[]
  amounts: Omit<RefundAmounts, 'shares'>
  /** Сбор не возвращается по правилам (показать до подтверждения, rules.md §7). */
  feeKeptKopecks: number
  block: CustomerRefundBlock | null
  deadline: Date | null
  /** Живой возврат по этим билетам (в процессе). */
  pending: RefundSummary | null
}

type Deps = {
  store: CommerceStore
  /** null — банк не подключён: деньги вернуть нельзя, возврат не создаётся. */
  provider: PaymentProvider | null
  wallet: Pick<WalletService, 'compensateRefund' | 'unqualifyReferral'>
  /** Начало показа для старых позиций без снимка (источник афиши). */
  performanceStart?: (performanceId: string) => Promise<Date | null>
  log: Logger
  now?: () => Date
  call?: CallOptions
  retry?: Parameters<typeof withRetry>[2]
}

/** Откаты транзакции открытия — наружу не выходят. */
class TicketTaken extends Error {}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function createRefundService({
  store,
  provider,
  wallet,
  performanceStart,
  log,
  now = () => new Date(),
  call,
  retry,
}: Deps) {
  const run = <T>(fn: (tx: CommerceTx) => Promise<T>) => withRetry(store, fn, retry)

  const policy = async (): Promise<RefundPolicy> =>
    parseRefundPolicy((await store.setting(REFUND_POLICY_KEY))?.value)

  const audit = (
    tx: CommerceTx,
    row: { actor: string; action: string; entityId: string; result: string; reason?: string },
    at: Date,
    correlationId?: string | null,
  ) =>
    tx.insertAudit({
      id: randomUUID(),
      actor: row.actor,
      action: row.action,
      entity: 'refund',
      entityId: row.entityId,
      reason: row.reason ?? null,
      result: row.result,
      correlationId: correlationId ?? null,
      at,
    })

  const actorLabel = (actor: RefundActor) =>
    actor.kind === 'customer' ? `customer:${actor.customerId}` : `staff:${actor.staffId}`

  /** Сводка для API/админки: номера билетов и заказа, без ПД. */
  const summarize = async (refund: RefundRow, order?: OrderRow | null): Promise<RefundSummary> => {
    const [shares, o] = await Promise.all([
      store.refundTickets(refund.id),
      order ?? store.order(refund.orderId),
    ])
    const tickets = o ? await store.tickets(o.id) : []
    const numbers = shares
      .map((s) => tickets.find((t) => t.id === s.ticketId)?.number)
      .filter((n): n is string => Boolean(n))
      .sort(cmp)
    return {
      id: refund.id,
      orderId: refund.orderId,
      orderNumber: o?.number ?? '',
      status: refund.status,
      publicStatus: publicRefundStatus(refund.status),
      kind: refund.kind,
      cashKopecks: refund.cashKopecks,
      bonusKopecks: refund.bonusKopecks,
      feeKopecks: refund.feeKopecks,
      bonusReversalKopecks: refund.bonusReversalKopecks,
      ticketNumbers: numbers,
      reason: refund.reason,
      requestedBy: refund.requestedBy,
      providerStatus: refund.providerStatus,
      lastError: refund.lastError,
      attempts: refund.attempts,
      createdAt: refund.createdAt,
      completedAt: refund.completedAt,
      bonusSettledAt: refund.bonusSettledAt,
    }
  }

  /** Начало самого раннего показа среди билетов: снимок позиции, иначе — источник афиши. */
  const earliestStart = async (orderId: string, tickets: readonly TicketRow[]) => {
    const items = await store.items(orderId)
    let earliest: Date | null = null
    for (const t of tickets) {
      const item = items.find((i) => i.id === t.orderItemId)
      const start =
        item?.startsAtSnapshot ??
        (performanceStart ? await performanceStart(t.performanceId) : null)
      if (!start) return null
      if (!earliest || start < earliest) earliest = start
    }
    return earliest
  }

  const sameSet = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && [...a].sort(cmp).every((x, i) => x === [...b].sort(cmp)[i])

  type OpenInput = {
    actor: RefundActor
    orderId: string
    /** id билетов; 'all' — все действующие билеты заказа (или заказ без билетов на проверке). */
    tickets: string[] | 'all'
    clientKey: string
    reason: string
    includeFee: boolean
    correlationId?: string | null
  }

  type Opened =
    | { ok: true; duplicate: boolean; refund: RefundRow; order: OrderRow }
    | { ok: false; error: RefundError; block?: CustomerRefundBlock; refund?: RefundRow }

  /** Шаг 1: открыть возврат атомарно (без банка). */
  async function open(input: OpenInput, rules: RefundPolicy, at: Date): Promise<Opened> {
    const { actor } = input
    const scope =
      actor.kind === 'customer' ? `customer:${actor.customerId}` : `staff:${actor.staffId}`
    const key = `refund:${scope}:${input.clientKey}`

    // Срок — по данным снимка/афиши, прочитанным до блокировки (они не меняются транзакцией).
    let startsAt: Date | null = null
    if (actor.kind === 'customer') {
      const all = await store.tickets(input.orderId)
      const chosen = input.tickets === 'all' ? all : all.filter((t) => input.tickets.includes(t.id))
      startsAt = await earliestStart(input.orderId, chosen)
    }

    try {
      return await run<Opened>(async (tx) => {
        const order = await tx.lockOrder(input.orderId)
        if (!order || (actor.kind === 'customer' && order.customerId !== actor.customerId))
          return { ok: false, error: 'NOT_FOUND' }

        const existing = await tx.findRefundByKey(key)
        if (existing) {
          if (existing.orderId !== order.id) return { ok: false, error: 'IDEMPOTENCY_CONFLICT' }
          const shares = await tx.listRefundTickets(existing.id)
          if (
            input.tickets !== 'all' &&
            !sameSet(
              shares.map((s) => s.ticketId),
              input.tickets,
            )
          )
            return { ok: false, error: 'IDEMPOTENCY_CONFLICT' }
          return { ok: true, duplicate: true, refund: existing, order }
        }

        const staffOnly = order.status === 'NEEDS_REVIEW'
        if (
          order.status !== 'PAID' &&
          order.status !== 'PARTIALLY_REFUNDED' &&
          !(staffOnly && actor.kind === 'staff')
        )
          return { ok: false, error: 'NOT_REFUNDABLE' }

        const tickets = await tx.lockTickets(order.id)
        const issued = tickets.filter((t) => t.status === 'ISSUED')
        let chosen: TicketRow[]
        if (input.tickets === 'all') chosen = issued
        else {
          const wanted = new Set(input.tickets)
          chosen = tickets.filter((t) => wanted.has(t.id))
          if (chosen.length !== wanted.size) return { ok: false, error: 'NOT_FOUND' }
          const busy = chosen.find((t) => t.status === 'REFUND_PENDING')
          if (busy) {
            const live = await tx.liveRefundOfTicket(busy.id)
            return { ok: false, error: 'IN_PROGRESS', refund: live ?? undefined }
          }
          if (chosen.some((t) => t.status !== 'ISSUED'))
            return { ok: false, error: 'NOT_REFUNDABLE' }
        }
        // Заказ на проверке без билетов (поздняя оплата без остатка, неверная сумма) — весь
        // платёж целиком; только сотрудник.
        const wholeOrder = staffOnly && tickets.length === 0
        if (!chosen.length && !wholeOrder) {
          const busy = tickets.find((t) => t.status === 'REFUND_PENDING')
          if (busy) {
            const live = await tx.liveRefundOfTicket(busy.id)
            return { ok: false, error: 'IN_PROGRESS', refund: live ?? undefined }
          }
          return { ok: false, error: 'NOTHING_TO_REFUND' }
        }
        if (
          staffOnly &&
          !wholeOrder &&
          (chosen.length !== issued.length || chosen.length !== tickets.length)
        )
          // Заказ на проверке закрывается только целиком: частичного перехода из NEEDS_REVIEW нет.
          return { ok: false, error: 'NOT_REFUNDABLE' }
        if (wholeOrder) {
          // Заказ заблокирован — открытия возвратов по нему идут по одному, чтение без гонки.
          const live = (await store.refundsOfOrder(order.id)).find((r) => r.status !== 'FAILED')
          if (live) return { ok: false, error: 'IN_PROGRESS', refund: live }
        }

        if (actor.kind === 'customer') {
          const block = customerRefundBlock({
            policy: rules,
            startsAt,
            now: at,
            requested: chosen.length,
            refundable: issued.length,
          })
          if (block) return { ok: false, error: 'BLOCKED', block }
        }

        const amounts = wholeOrder
          ? {
              shares: [],
              cashKopecks: order.cashKopecks,
              bonusKopecks: order.bonusKopecks,
              feeKopecks: order.feeKopecks,
            }
          : refundAmounts(chosen, { includeFee: input.includeFee })
        if (amounts.cashKopecks > 0 && (!order.providerPaymentId || !order.paymentProvider))
          return { ok: false, error: 'PAYMENT_UNAVAILABLE' }

        const refund: RefundRow = {
          id: randomUUID(),
          orderId: order.id,
          status: 'REQUESTED',
          kind: actor.kind,
          cashKopecks: amounts.cashKopecks,
          bonusKopecks: amounts.bonusKopecks,
          feeKopecks: amounts.feeKopecks,
          bonusReversalKopecks: 0,
          idempotencyKey: key,
          provider: order.paymentProvider,
          providerRefundId: null,
          providerStatus: null,
          attempts: 0,
          // Если процесс упадёт до обращения к банку, сверка подхватит возврат сразу.
          nextAttemptAt: at,
          lastError: null,
          reason: input.reason,
          requestedBy: actorLabel(actor),
          correlationId: input.correlationId ?? null,
          completedAt: null,
          bonusSettledAt: null,
          createdAt: at,
          updatedAt: at,
        }
        if (!(await tx.insertRefund(refund))) {
          // Параллельный запрос с тем же ключом успел первым — его возврат и есть наш.
          const same = await tx.findRefundByKey(refund.idempotencyKey)
          if (!same) throw new Error('refund key conflict without a row')
          return { ok: true, duplicate: true, refund: same, order }
        }
        const shares = amounts.shares.map((s) => ({ ...s, refundId: refund.id, voidedAt: null }))
        if (!(await tx.insertRefundTickets(shares))) throw new TicketTaken()
        const ids = shares.map((s) => s.ticketId)
        if (
          (await tx.updateTickets(ids, 'ISSUED', {
            status: 'REFUND_PENDING',
            refundedAt: null,
          })) !== ids.length
        )
          throw new TicketTaken()
        await audit(
          tx,
          {
            actor: actorLabel(actor),
            action: 'refund.requested',
            entityId: refund.id,
            reason: input.reason,
            result: `REQUESTED order=${order.number} tickets=${ids.length} cash=${amounts.cashKopecks} bonus=${amounts.bonusKopecks} fee=${amounts.feeKopecks}`,
          },
          at,
          input.correlationId,
        )
        return { ok: true, duplicate: false, refund, order }
      })
    } catch (error) {
      if (!(error instanceof TicketTaken)) throw error
      // Параллельный возврат тех же билетов зафиксировался раньше — ответить его статусом.
      const ids =
        input.tickets === 'all'
          ? (await store.tickets(input.orderId)).map((t) => t.id)
          : input.tickets
      for (const id of ids) {
        const live = await run((tx) => tx.liveRefundOfTicket(id))
        if (live) return { ok: false, error: 'IN_PROGRESS', refund: live }
      }
      return { ok: false, error: 'IN_PROGRESS' }
    }
  }

  /** Перевести возврат по событию state-machine (условный UPDATE). null — перехода нет. */
  const move = async (
    tx: CommerceTx,
    refund: RefundRow,
    event: RefundEvent,
    set: RefundUpdate,
    at: Date,
  ) => {
    const t = refundTransition(refund.status, event)
    if (!t.ok) return null
    if (t.noop) return refund
    if (!(await tx.updateRefund(refund.id, refund.status, { ...set, status: t.to }, at)))
      throw new Error('refund changed concurrently')
    return { ...refund, ...set, status: t.to, updatedAt: at }
  }

  /** Шаг 3а: банк подтвердил. Билеты, остаток, заказ, outbox, аудит — одной транзакцией. */
  async function succeed(refundId: string, result: ProviderRefund | null, actor: string) {
    const at = now()
    const rules = await policy()
    return run(async (tx) => {
      const head = await store.refund(refundId)
      if (!head) return null
      const order = await tx.lockOrder(head.orderId)
      const refund = await tx.lockRefund(refundId)
      if (!order || !refund) return null
      if (refund.status === 'SUCCEEDED') return refund
      const shares = (await tx.listRefundTickets(refund.id)).filter((s) => s.voidedAt === null)
      const tickets = await tx.lockTickets(order.id)
      const ids = shares.map((s) => s.ticketId)
      const moved = await move(
        tx,
        refund,
        'PROVIDER_SUCCEEDED',
        {
          providerRefundId: result?.providerRefundId ?? refund.providerRefundId,
          providerStatus: result ? result.status : 'not_required',
          completedAt: at,
          nextAttemptAt: null,
          lastError: null,
        },
        at,
      )
      if (!moved) {
        log.alert(ALERTS.paymentReview, { refundId, reason: 'REFUND_SUCCEEDED_UNEXPECTED_STATE' })
        return refund
      }
      if (
        (await tx.updateTickets(ids, 'REFUND_PENDING', { status: 'REFUNDED', refundedAt: at })) !==
        ids.length
      )
        throw new Error('refund tickets changed concurrently')
      const refunded = tickets.filter((t) => ids.includes(t.id))
      // Место/квота — снова в продажу, если так решил театр (настройка, по умолчанию — да).
      if (rules.returnToSale && refunded.length)
        await returnSold(
          tx,
          refunded.map((t) => ({
            performanceId: t.performanceId,
            ticketTypeId: t.ticketTypeId,
            seatId: t.seatId,
            quantity: 1,
          })),
          order.id,
          at,
        )
      const left = tickets.filter((t) => !ids.includes(t.id) && t.status !== 'REFUNDED')
      const event: OrderEvent =
        left.length === 0 ? { type: 'REFUNDED_FULLY', at } : { type: 'REFUNDED_PARTIALLY', at }
      const step = transition(order, event)
      if (!step.ok) throw new Error(`invalid order transition ${step.from} → ${step.event}`)
      if (
        !('noop' in step) &&
        !(await tx.updateOrder(order.id, step.from, { status: step.to, ...step.patch }, at))
      )
        throw new Error('order changed concurrently')
      await tx.insertOutbox({
        id: randomUUID(),
        kind: 'refund.succeeded',
        dedupeKey: `refund.succeeded:${refund.id}`,
        aggregateId: refund.id,
        // Без ПД: письмо само читает возврат и заказ по id.
        payload: { refundId: refund.id },
        status: 'pending',
        attempts: 0,
        nextAttemptAt: at,
        lastError: null,
        createdAt: at,
        processedAt: null,
      })
      await audit(
        tx,
        {
          actor,
          action: 'refund.succeeded',
          entityId: refund.id,
          result: `SUCCEEDED provider=${refund.provider ?? '-'} providerRefundId=${moved.providerRefundId ?? '-'} order=${order.number}→${'noop' in step ? order.status : step.to} returnedToSale=${rules.returnToSale}`,
        },
        at,
        refund.correlationId,
      )
      return moved
    })
  }

  /** Шаг 3б: банк отказал/отменил — деньги не ушли, билеты снова действуют. */
  async function fail(refundId: string, providerStatus: string, actor: string, error?: string) {
    const at = now()
    const done = await run(async (tx) => {
      const head = await store.refund(refundId)
      if (!head) return null
      const order = await tx.lockOrder(head.orderId)
      const refund = await tx.lockRefund(refundId)
      if (!order || !refund) return null
      const moved = await move(
        tx,
        refund,
        'PROVIDER_FAILED',
        { providerStatus, completedAt: at, nextAttemptAt: null, lastError: error ?? null },
        at,
      )
      if (!moved || moved === refund) return refund
      const ids = (await tx.listRefundTickets(refund.id))
        .filter((s) => s.voidedAt === null)
        .map((s) => s.ticketId)
      await tx.lockTickets(order.id)
      await tx.voidRefundTickets(refund.id, at)
      if (
        (await tx.updateTickets(ids, 'REFUND_PENDING', { status: 'ISSUED', refundedAt: null })) !==
        ids.length
      )
        throw new Error('refund tickets changed concurrently')
      await audit(
        tx,
        {
          actor,
          action: 'refund.failed',
          entityId: refund.id,
          result: `FAILED provider=${refund.provider ?? '-'} status=${providerStatus}${error ? ` error=${error}` : ''}`,
        },
        at,
        refund.correlationId,
      )
      return moved
    })
    if (done?.status === 'FAILED')
      log.alert(ALERTS.paymentReview, { refundId, reason: 'REFUND_FAILED', providerStatus })
    return done
  }

  /** Банк принял возврат, но ещё обрабатывает: ждём, сверка спросит позже. */
  async function markPending(refundId: string, result: ProviderRefund, actor: string) {
    const at = now()
    return run(async (tx) => {
      const refund = await tx.lockRefund(refundId)
      if (!refund) return null
      const moved = await move(
        tx,
        refund,
        'PROVIDER_PENDING',
        { providerRefundId: result.providerRefundId, providerStatus: 'pending', lastError: null },
        at,
      )
      if (moved && moved !== refund)
        await audit(
          tx,
          {
            actor,
            action: 'refund.pending',
            entityId: refund.id,
            result: `PENDING provider=${refund.provider ?? '-'} providerRefundId=${result.providerRefundId}`,
          },
          at,
          refund.correlationId,
        )
      return moved ?? refund
    })
  }

  /** Неизвестный исход (таймаут, банк недоступен): записать попытку; после лимита — человеку. */
  async function markUnknown(refundId: string, kind: string, actor: string) {
    const at = now()
    const updated = await run(async (tx) => {
      const refund = await tx.lockRefund(refundId)
      if (!refund || isFinalRefund(refund.status) || refund.status === 'MANUAL_REVIEW')
        return refund
      const tooLong =
        refund.status === 'PENDING'
          ? at.getTime() - refund.createdAt.getTime() >= PENDING_REVIEW_AFTER_MS
          : refund.attempts >= MAX_UNKNOWN_ATTEMPTS
      if (!tooLong) {
        await tx.updateRefund(refund.id, refund.status, { lastError: kind }, at)
        return { ...refund, lastError: kind }
      }
      const moved = await move(
        tx,
        refund,
        'NEEDS_MANUAL_REVIEW',
        { lastError: kind, nextAttemptAt: null },
        at,
      )
      // Сигнал — ALERT_PAYMENT_REVIEW ниже и список «На разборе» в админке; событие outbox без
      // обработчика висело бы вечно и забивало монитор outbox.
      await audit(
        tx,
        {
          actor,
          action: 'refund.manual_review',
          entityId: refund.id,
          result: `MANUAL_REVIEW attempts=${refund.attempts} last=${kind}`,
        },
        at,
        refund.correlationId,
      )
      return moved
    })
    if (updated?.status === 'MANUAL_REVIEW')
      log.alert(ALERTS.paymentReview, { refundId, reason: 'REFUND_STUCK', last: kind })
    return updated
  }

  /**
   * Занять попытку обращения к банку: +1 попытка и следующая не раньше чем через паузу. Второй
   * участник (сверка во время запроса зрителя) попытку не получает — банк не дёргается зря;
   * даже если бы получил, ключ `refund:<id>` не даст вернуть деньги дважды.
   */
  async function claim(refundId: string, force: boolean) {
    const at = now()
    return run(async (tx) => {
      const refund = await tx.lockRefund(refundId)
      if (!refund || isFinalRefund(refund.status)) return null
      if (refund.status === 'MANUAL_REVIEW' && !force) return null
      if (!force && refund.nextAttemptAt && refund.nextAttemptAt > at) return null
      const attempts = refund.attempts + 1
      const set: RefundUpdate = {
        attempts,
        nextAttemptAt: new Date(at.getTime() + retryDelayMs(attempts)),
      }
      if (!(await tx.updateRefund(refund.id, refund.status, set, at))) return null
      return { ...refund, ...set }
    })
  }

  /** Обращение к банку: таймаут, повтор, метрика отказов (в лог — операция и вид ошибки). */
  const bank = <T>(op: string, fn: (p: PaymentProvider, signal: AbortSignal) => Promise<T>) => {
    const p = provider
    if (!p) throw new PaymentProviderError('unavailable', 'payment provider is not configured')
    return callProvider((signal) => fn(p, signal), {
      ...call,
      onFailure: ({ attempt, kind }) =>
        log.warn('refund.provider_failed', { op, provider: p.id, attempt, kind }),
    })
  }

  /** Шаг 2: спросить/попросить банк и применить ответ. Без транзакции во время вызова. */
  async function submit(refundId: string, actor: string, { force = false } = {}) {
    const refund = await claim(refundId, force)
    if (!refund) return store.refund(refundId)
    const order = await store.order(refund.orderId)
    if (!order) throw new Error('refund without order')
    if (refund.cashKopecks === 0) {
      // Денег к возврату нет (всё оплачено бонусами) — банк не нужен.
      const done = await succeed(refund.id, null, actor)
      if (done?.status === 'SUCCEEDED') await settleBonuses(refund.id)
      return done ?? refund
    }
    if (!provider || order.paymentProvider !== provider.id || !order.providerPaymentId)
      return markUnknown(refund.id, 'provider_unavailable', actor)
    let result: ProviderRefund | null
    try {
      // Возврат уже известен банку — статус по id, если банк это умеет; иначе — повтор с ключом.
      result =
        refund.providerRefundId && provider.getRefund
          ? await bank('getRefund', (p, signal) => p.getRefund!(refund.providerRefundId!, signal))
          : await bank('refund', (p, signal) =>
              p.refund(
                {
                  idempotencyKey: `refund:${refund.id}`,
                  providerPaymentId: order.providerPaymentId!,
                  amountKopecks: refund.cashKopecks,
                  currency: order.currency,
                },
                signal,
              ),
            )
    } catch (error) {
      if (error instanceof PaymentProviderError && error.kind === 'rejected')
        return fail(refund.id, 'rejected', actor, 'provider_rejected')
      const kind = error instanceof PaymentProviderError ? error.kind : errorInfo(error).name
      log.warn('refund.provider_unknown', { refundId: refund.id, kind })
      return markUnknown(refund.id, kind, actor)
    }
    if (!result) return markUnknown(refund.id, 'not_found_at_provider', actor)
    if (result.amountKopecks !== refund.cashKopecks) {
      // Банк вернул не ту сумму — не помечать ни успехом, ни отказом: разбирает человек.
      log.alert(ALERTS.paymentReview, { refundId: refund.id, reason: 'REFUND_AMOUNT_MISMATCH' })
      return run(async (tx) => {
        const r = await tx.lockRefund(refund.id)
        return r
          ? ((await move(
              tx,
              r,
              'NEEDS_MANUAL_REVIEW',
              { lastError: 'amount_mismatch', providerStatus: result.status },
              now(),
            )) ?? r)
          : null
      })
    }
    if (result.status === 'succeeded') {
      const done = await succeed(refund.id, result, actor)
      if (done?.status === 'SUCCEEDED') await settleBonuses(refund.id)
      return done
    }
    if (result.status === 'canceled') return fail(refund.id, 'canceled', actor, 'provider_canceled')
    return markPending(refund.id, result, actor)
  }

  /**
   * Шаг 4: бонусы по успешному возврату (идемпотентно). Сторно 3% — по доле билетов возврата
   * (`reversalShare`), потраченные — доля билетов, записанная при выпуске.
   */
  async function settleBonuses(refundId: string) {
    const refund = await store.refund(refundId)
    if (!refund || refund.status !== 'SUCCEEDED' || refund.bonusSettledAt) return refund
    const order = await store.order(refund.orderId)
    if (!order) return refund
    const at = now()
    let note = 'guest'
    let reversal = 0
    if (order.customerId) {
      const [tickets, shares] = await Promise.all([
        store.tickets(order.id),
        store.refundTickets(refund.id),
      ])
      const ids = new Set(shares.filter((s) => s.voidedAt === null).map((s) => s.ticketId))
      const result = await wallet.compensateRefund(
        {
          customerId: order.customerId,
          orderId: order.id,
          refundId: refund.id,
          returnSpentKopecks: refund.bonusKopecks,
          reversalShare: (accrued) => reversalShare(accrued, tickets, ids),
        },
        at,
      )
      reversal = result.reversedKopecks
      note = `returned=${result.returnedKopecks} reversed=${result.reversedKopecks} covered=${result.coveredKopecks} debt=${result.debtKopecks}${result.accrualMissing ? ' accrual=none' : ''}`
      if (result.returnedKopecks < refund.bonusKopecks && !result.duplicate)
        log.alert(ALERTS.paymentReview, { refundId, reason: 'REFUND_BONUS_SHORTFALL' })
      // T-062: покупка друга возвращена целиком — он больше не засчитан (если нет другой
      // действующей покупки и награда за его тройку не выдана; выданную не отбираем).
      if (order.status === 'REFUNDED') {
        const customerId = order.customerId
        const referral = await wallet.unqualifyReferral(customerId, {
          stillQualifies: () => store.hasLiveOrder(customerId, order.id),
        })
        note += ` referral=${referral.unqualified ? 'unqualified' : referral.reason}`
        if (referral.unqualified) log.info('wallet.referral_unqualified', { orderId: order.id })
      }
    }
    return run(async (tx) => {
      const r = await tx.lockRefund(refund.id)
      if (!r || r.bonusSettledAt) return r
      await tx.updateRefund(
        r.id,
        'SUCCEEDED',
        { bonusSettledAt: at, bonusReversalKopecks: reversal },
        at,
      )
      await audit(
        tx,
        { actor: 'system', action: 'refund.bonus_settled', entityId: r.id, result: note },
        at,
        r.correlationId,
      )
      return { ...r, bonusSettledAt: at, bonusReversalKopecks: reversal }
    })
  }

  const respond = async (opened: Opened, actor: string): Promise<RefundRequestResult> => {
    if (!opened.ok)
      return {
        ok: false,
        error: opened.error,
        block: opened.block,
        refund: opened.refund ? await summarize(opened.refund) : undefined,
      }
    // Повтор того же запроса (двойной клик) банк не трогает: ответ — текущий статус.
    const refund = opened.duplicate
      ? opened.refund
      : ((await submit(opened.refund.id, actor)) ?? opened.refund)
    const fresh = (await store.refund(refund.id)) ?? refund
    return { ok: true, duplicate: opened.duplicate, refund: await summarize(fresh, opened.order) }
  }

  /** Билеты покупателя по номерам — все из одного заказа; чужие и неизвестные неразличимы. */
  const customerTickets = async (customerId: string, numbers: readonly string[]) => {
    if (!numbers.length || numbers.length > MAX_TICKETS) return null
    const tickets: TicketRow[] = []
    for (const n of new Set(numbers)) {
      const t = await store.ticketByNumber(n)
      if (!t) return null
      tickets.push(t)
    }
    const orderId = tickets[0]!.orderId
    if (tickets.some((t) => t.orderId !== orderId)) return null
    const order = await store.order(orderId)
    if (!order || order.customerId !== customerId) return null
    return { order, tickets }
  }

  /** Предпросмотр для кнопки «Вернуть билет» (до подтверждения — сумма и последствия). */
  async function quoteForCustomer(
    customerId: string,
    ticketNumbers: readonly string[],
  ): Promise<CustomerRefundQuote | null> {
    const found = await customerTickets(customerId, ticketNumbers)
    if (!found) return null
    const { order } = found
    const rules = await policy()
    const all = await store.tickets(order.id)
    const issued = all.filter((t) => t.status === 'ISSUED')
    const wanted = new Set(found.tickets.map((t) => t.id))
    // Частичный возврат запрещён — в возврат входят все оставшиеся билеты заказа.
    const chosen = rules.allowPartial ? issued.filter((t) => wanted.has(t.id)) : issued
    let pending: RefundRow | null = null
    for (const t of found.tickets)
      if (t.status === 'REFUND_PENDING') pending ??= await run((tx) => tx.liveRefundOfTicket(t.id))
    const startsAt = await earliestStart(order.id, chosen.length ? chosen : found.tickets)
    const live = order.status === 'PAID' || order.status === 'PARTIALLY_REFUNDED'
    const block =
      live && chosen.length
        ? customerRefundBlock({
            policy: rules,
            startsAt,
            now: now(),
            requested: chosen.length,
            refundable: issued.length,
          })
        : 'NOT_REFUNDABLE'
    const amounts = refundAmounts(chosen, { includeFee: rules.refundServiceFee })
    return {
      orderNumber: order.number,
      ticketNumbers: chosen.map((t) => t.number).sort(cmp),
      otherRefundable: issued
        .filter((t) => !chosen.includes(t))
        .map((t) => t.number)
        .sort(cmp),
      amounts: {
        cashKopecks: amounts.cashKopecks,
        bonusKopecks: amounts.bonusKopecks,
        feeKopecks: amounts.feeKopecks,
      },
      feeKeptKopecks: rules.refundServiceFee ? 0 : chosen.reduce((n, t) => n + t.feeKopecks, 0),
      block,
      deadline: startsAt
        ? new Date(startsAt.getTime() - rules.deadlineHoursBeforeStart * 3_600_000)
        : null,
      pending: pending ? await summarize(pending, order) : null,
    }
  }

  /**
   * Возврат зрителем из кабинета (POST /api/account/refunds). Покупатель — из сессии; билеты —
   * только его. Повтор с тем же `clientKey` (двойной клик) — тот же возврат, банк не дёргается.
   */
  async function requestCustomerRefund(input: {
    customerId: string
    ticketNumbers: string[]
    clientKey: string
    correlationId?: string | null
  }): Promise<RefundRequestResult> {
    if (!CLIENT_KEY.test(input.clientKey)) return { ok: false, error: 'INVALID_KEY' }
    const found = await customerTickets(input.customerId, input.ticketNumbers)
    if (!found) return { ok: false, error: 'NOT_FOUND' }
    const rules = await policy()
    if (!rules.customerRefundsEnabled) return { ok: false, error: 'BLOCKED', block: 'DISABLED' }
    if (!provider) return { ok: false, error: 'PAYMENT_UNAVAILABLE' }
    const actor: RefundActor = { kind: 'customer', customerId: input.customerId }
    const opened = await open(
      {
        actor,
        orderId: found.order.id,
        tickets: found.tickets.map((t) => t.id),
        clientKey: input.clientKey,
        reason: 'customer_request',
        includeFee: rules.refundServiceFee,
        correlationId: input.correlationId,
      },
      rules,
      now(),
    )
    return respond(opened, actorLabel(actor))
  }

  /**
   * Возврат сотрудником (админка, T-053): полный (все действующие билеты) или частичный (выбранные),
   * причина обязательна. Срок и флаг кабинета не действуют; финансовые инварианты — те же.
   * Роль (кассир/администратор) проверяет вызывающий в access layer.
   */
  async function requestStaffRefund(input: {
    staff: Extract<RefundActor, { kind: 'staff' }>
    orderNumber: string
    /** Номера билетов; пусто — все действующие билеты заказа. */
    ticketNumbers: string[]
    reason: string
    includeFee: boolean
    clientKey: string
    correlationId?: string | null
  }): Promise<RefundRequestResult> {
    if (!CLIENT_KEY.test(input.clientKey)) return { ok: false, error: 'INVALID_KEY' }
    const reason = input.reason.trim()
    if (reason.length < 3 || reason.length > REASON_MAX)
      return { ok: false, error: 'INVALID_REASON' }
    const order = await store.orderByNumber(input.orderNumber.trim().toUpperCase())
    if (!order) return { ok: false, error: 'NOT_FOUND' }
    let ids: string[] | 'all' = 'all'
    if (input.ticketNumbers.length) {
      if (input.ticketNumbers.length > MAX_TICKETS) return { ok: false, error: 'NOT_FOUND' }
      const tickets = await store.tickets(order.id)
      const byNumber = new Map(tickets.map((t) => [t.number, t.id]))
      ids = []
      for (const n of new Set(input.ticketNumbers)) {
        const id = byNumber.get(n)
        if (!id) return { ok: false, error: 'NOT_FOUND' }
        ids.push(id)
      }
    }
    if (!provider && order.cashKopecks > 0) return { ok: false, error: 'PAYMENT_UNAVAILABLE' }
    const opened = await open(
      {
        actor: input.staff,
        orderId: order.id,
        tickets: ids,
        clientKey: input.clientKey,
        reason,
        includeFee: input.includeFee,
        correlationId: input.correlationId,
      },
      await policy(),
      now(),
    )
    return respond(opened, actorLabel(input.staff))
  }

  /** Повторить запрос в банк по возврату на ручном разборе (сотрудник; тот же ключ банка). */
  async function retryRefund(
    refundId: string,
    staff: Extract<RefundActor, { kind: 'staff' }>,
    reason: string,
  ) {
    const refund = await store.refund(refundId)
    if (!refund || isFinalRefund(refund.status)) return null
    await run(async (tx) => {
      await audit(
        tx,
        {
          actor: actorLabel(staff),
          action: 'refund.retry',
          entityId: refundId,
          reason: reason.trim().slice(0, REASON_MAX) || 'manual_retry',
          result: refund.status,
        },
        now(),
        refund.correlationId,
      )
    })
    const done = await submit(refundId, actorLabel(staff), { force: true })
    return done ? summarize(done) : null
  }

  /**
   * Сверка (worker): возвраты, которым пора к банку (неизвестный исход, «в обработке»), и
   * успешные без компенсации бонусов. Каждый шаг идемпотентен; сбой одного не мешает другим.
   */
  async function reconcile() {
    const at = now()
    const stats = {
      checked: 0,
      succeeded: 0,
      failed: 0,
      pending: 0,
      review: 0,
      settled: 0,
      errors: 0,
    }
    for (const due of await store.refundsDue(['REQUESTED', 'PENDING'], at, RECONCILE_BATCH)) {
      stats.checked++
      try {
        const r = await submit(due.id, 'worker')
        if (r?.status === 'SUCCEEDED') stats.succeeded++
        else if (r?.status === 'FAILED') stats.failed++
        else if (r?.status === 'MANUAL_REVIEW') stats.review++
        else stats.pending++
      } catch (error) {
        stats.errors++
        log.warn('refund.reconcile_failed', { refundId: due.id, error: errorInfo(error) })
      }
    }
    for (const r of await store.refundsUnsettled(RECONCILE_BATCH)) {
      try {
        if ((await settleBonuses(r.id))?.bonusSettledAt) stats.settled++
      } catch (error) {
        stats.errors++
        log.warn('refund.bonus_settle_failed', { refundId: r.id, error: errorInfo(error) })
      }
    }
    return stats
  }

  /** Последние возвраты (админка). */
  async function recent(limit = RECENT_LIMIT) {
    const rows = await store.recentRefunds(Math.min(limit, RECENT_LIMIT))
    return Promise.all(rows.map((r) => summarize(r)))
  }

  /** Заказ для кассы: билеты, их доли и возвраты (без ПД покупателя, кроме номера заказа). */
  async function orderForStaff(orderNumber: string) {
    const order = await store.orderByNumber(orderNumber.trim().toUpperCase())
    if (!order) return null
    const [tickets, refunds] = await Promise.all([
      store.tickets(order.id),
      store.refundsOfOrder(order.id),
    ])
    return {
      order: {
        id: order.id,
        number: order.number,
        status: order.status,
        grossKopecks: order.grossKopecks,
        bonusKopecks: order.bonusKopecks,
        feeKopecks: order.feeKopecks,
        cashKopecks: order.cashKopecks,
        paidAt: order.paidAt,
        guest: order.customerId === null,
        reviewReason: order.reviewReason,
      },
      tickets: tickets.map((t) => ({
        number: t.number,
        status: t.status,
        cashKopecks: t.cashKopecks,
        bonusKopecks: t.bonusKopecks,
        feeKopecks: t.feeKopecks,
      })),
      refunds: await Promise.all(refunds.map((r) => summarize(r, order))),
    }
  }

  /** Сменить политику (только администратор театра — проверяет вызывающий). С аудитом. */
  async function updatePolicy(next: unknown, staff: Extract<RefundActor, { kind: 'staff' }>) {
    const parsed = refundPolicySchema.safeParse(next)
    if (!parsed.success) return { ok: false as const, error: 'INVALID' as const }
    const at = now()
    await run(async (tx) => {
      await tx.upsertSetting({
        key: REFUND_POLICY_KEY,
        value: parsed.data,
        updatedBy: actorLabel(staff),
        updatedAt: at,
      })
      await tx.insertAudit({
        id: randomUUID(),
        actor: actorLabel(staff),
        action: 'refund_policy.updated',
        entity: 'setting',
        entityId: REFUND_POLICY_KEY,
        reason: null,
        result: JSON.stringify(parsed.data),
        correlationId: null,
        at,
      })
    })
    return { ok: true as const, policy: parsed.data }
  }

  return {
    available: provider !== null,
    policy,
    updatePolicy,
    quoteForCustomer,
    requestCustomerRefund,
    requestStaffRefund,
    retryRefund,
    reconcile,
    settleBonuses,
    recent,
    orderForStaff,
    refund: async (id: string) => {
      const r = await store.refund(id)
      return r ? summarize(r) : null
    },
  }
}

export type RefundService = ReturnType<typeof createRefundService>
