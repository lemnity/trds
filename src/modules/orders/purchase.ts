import { createHmac, timingSafeEqual } from 'node:crypto'

import { ALERTS, errorInfo, type Logger } from '@/lib/log'
import { SERVICE_FEE, quoteOrder, type OrderStatus, type Selection } from '@/modules/checkout'
import {
  capacityFromPerformance,
  type InventoryService,
  type Unavailable,
} from '@/modules/inventory/inventory'
import type { CommerceStore, OrderRow } from '@/modules/inventory/store'
import { applyBonus } from '@/modules/loyalty'
import {
  PaymentProviderError,
  callProvider,
  type CallOptions,
  type NotificationRequest,
  type PaymentMethodHint,
  type PaymentProvider,
  type ProviderPayment,
} from '@/modules/payments'
import { quoteSeats } from '@/modules/seating'
import type { Performance, SalePerformance } from '@/modules/shows'
import type { WalletService } from '@/modules/wallet/service'

import type { OrderLineSnapshot, OrderService, PaymentCheck, PlaceOrderLine } from './service'

/**
 * Покупка и обработка оплаты (T-044, T-045, T-061, T-062; architecture.md §9). Только сервер.
 * Склеивает заказ (`OrderService`), кошелёк и `PaymentProvider`, не держа DB-транзакцию во время
 * обращения к банку:
 *
 *   оформление: выбор → цены показа → applyBonus → placeOrder (заказ + бронь) → spend бонусов
 *   (`spend:<orderId>`) → createPayment (`payment:<orderId>`) → attachPayment → адрес банка;
 *   оплата: уведомление/сверка → getPayment у банка (сумма, валюта, заказ) → confirmPayment →
 *   начисление 3% и «Приведи друга»; несостоявшийся заказ → компенсация списания бонусов.
 *
 * Все шаги идемпотентны по своим ключам, поэтому повтор запроса, дубль webhook и повторный
 * проход worker безопасны; потерянный шаг (падение процесса между ними) доделывает `reconcile`.
 */

/** Сверять ожидающий платёж с банком не раньше, чем через столько после оформления. */
export const RECONCILE_AFTER_MS = 2 * 60_000
/** Как часто страница результата может спрашивать банк об одном заказе. */
export const STATUS_SYNC_EVERY_MS = 5_000
const PENDING_WINDOW_MS = 24 * 60 * 60_000
const COMPENSATION_WINDOW_MS = 3 * 24 * 60 * 60_000
const SETTLEMENT_WINDOW_MS = 6 * 60 * 60_000
const SWEEP_LIMIT = 500
const CLIENT_KEY = /^[A-Za-z0-9-]{16,100}$/

export type PurchaseWallet = Pick<
  WalletService,
  'balance' | 'spend' | 'releaseSpend' | 'spendStatus' | 'accrue' | 'qualifyReferral'
>

type Deps = {
  orders: OrderService
  inventory: Pick<InventoryService, 'syncCapacity'>
  /** Чтение остатков без блокировок: есть ли строки показа в ядре продаж. */
  stock: Pick<CommerceStore, 'inventory' | 'seats'>
  wallet: PurchaseWallet
  /** null — оплата не подключена (PAYMENT_PROVIDER пуст). */
  provider: PaymentProvider | null
  /** Секрет ссылки на статус заказа (HMAC от PAYLOAD_SECRET с отдельной меткой). */
  statusSecret: string
  log: Logger
  now?: () => Date
  call?: CallOptions
  holdTtlMs?: number
  /**
   * Продавать по ценам/сбору-заглушкам (не утверждённым театром). Только учебный банк:
   * с настоящим банком заглушка не уйдёт в платёж.
   */
  allowPlaceholderPrices?: boolean
}

export type CheckoutInput = {
  /** Ключ попытки оформления из браузера: повтор запроса — тот же ключ. */
  clientKey: string
  performance: SalePerformance
  selection: Selection
  email: string
  /** Из серверной сессии; гость — null. */
  customerId: string | null
  /** Пожелание зрителя; сервер ограничит его правилом 30% и балансом. */
  requestedBonusKopecks: number
  method: PaymentMethodHint
  /** Адрес сайта для возврата из банка. */
  siteOrigin: string
  correlationId?: string | null
}

export type CheckoutError =
  | 'PAYMENT_UNAVAILABLE'
  | 'INVALID_KEY'
  | 'INVALID_SELECTION'
  | 'PRICES_NOT_APPROVED'
  | 'UNAVAILABLE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'ORDER_CLOSED'
  | 'BONUS_CHANGED'
  /** Банк отказал окончательно: заказ отменён, бронь и бонусы возвращены. */
  | 'PAYMENT_FAILED'
  /** Исход неизвестен (таймаут): повторить с тем же ключом — второго платежа не будет. */
  | 'PAYMENT_RETRY'

export type CheckoutResult =
  | {
      ok: true
      replay: boolean
      orderId: string
      orderNumber: string
      status: OrderStatus
      amountKopecks: number
      holdUntil: Date | null
      /** Куда отправить покупателя: страница банка или страница результата. */
      redirectUrl: string
      resultUrl: string
    }
  | { ok: false; error: CheckoutError; unavailable?: Unavailable[] }

/** Статус для страницы результата: только то, что нужно покупателю, без ПД. */
export type PublicOrderStatus = 'pending' | 'paid' | 'refunded' | 'failed' | 'expired' | 'review'

export type OrderStatusView = {
  orderId: string
  orderNumber: string
  status: PublicOrderStatus
  amountKopecks: number
  ticketCount: number
  holdUntil: Date | null
}

export type NotificationResult = { status: number; body: Record<string, unknown> }

const PUBLIC_STATUS: Record<OrderStatus, PublicOrderStatus> = {
  DRAFT: 'pending',
  PENDING_PAYMENT: 'pending',
  PAID: 'paid',
  PARTIALLY_REFUNDED: 'paid',
  REFUNDED: 'refunded',
  CANCELLED: 'failed',
  EXPIRED: 'expired',
  NEEDS_REVIEW: 'review',
}

const SEAT_SECTIONS = { left: 'левая сторона', center: 'центр', right: 'правая сторона' } as const

type Lines = {
  lines: PlaceOrderLine[]
  ticketsKopecks: number
  ticketCount: number
  placeholder: boolean
}

/** Снимок показа для позиций: название, время, площадка — на момент оформления. */
const snapshotOf = (performance: SalePerformance): OrderLineSnapshot => ({
  showTitle: performance.show.title,
  showSlug: performance.show.slug,
  startsAt: new Date(performance.startsAt),
  venue: performance.venue
    ? { title: performance.venue.title, address: performance.venue.address }
    : null,
})

/**
 * Позиции заказа из выбора зрителя — цены только из данных показа (CMS), клиент присылает лишь
 * категории/количества или места. Подозрительный выбор — null, без «примерных» догадок.
 */
export function orderLines(performance: SalePerformance, selection: Selection): Lines | null {
  if (selection.kind === 'tickets') {
    if (performance.seating) return null
    const quote = quoteOrder(performance.ticketTypes, selection.quantities)
    if (!quote.ok) return null
    const used = new Set(quote.quote.lines.map((l) => l.ticketTypeId))
    const snapshot = snapshotOf(performance)
    return {
      lines: quote.quote.lines.map((l) => ({
        performanceId: performance.id,
        ticketTypeId: l.ticketTypeId,
        title: l.title,
        unitPriceKopecks: l.unitPriceKopecks,
        quantity: l.quantity,
        snapshot,
      })),
      ticketsKopecks: quote.quote.totalKopecks,
      ticketCount: quote.quote.ticketCount,
      placeholder: performance.ticketTypes.some((t) => used.has(t.id) && t.placeholder === true),
    }
  }
  if (!performance.seating) return null
  const { plan, pricesKopecks, unavailableSeatIds, pricesPlaceholder } = performance.seating
  const quote = quoteSeats(plan, pricesKopecks, new Set(unavailableSeatIds), selection.seatIds)
  if (!quote.ok) return null
  const category = new Map(plan.categories.map((c) => [c.id, c.title]))
  const snapshot = snapshotOf(performance)
  return {
    lines: quote.quote.seats.map((s) => ({
      performanceId: performance.id,
      ticketTypeId: s.categoryId,
      seatId: s.id,
      title: `${category.get(s.categoryId) ?? s.categoryId} · ${SEAT_SECTIONS[s.section]}, ряд ${s.row}, место ${s.number}`,
      unitPriceKopecks: s.priceKopecks,
      quantity: 1,
      snapshot,
    })),
    ticketsKopecks: quote.quote.totalKopecks,
    ticketCount: quote.quote.ticketCount,
    placeholder: pricesPlaceholder,
  }
}

/** Показ витрины → вход синхронизации остатков (тот же, что из CMS). */
const capacitySource = (p: SalePerformance): Performance => ({
  id: p.id,
  showSlug: p.show.slug,
  venueId: p.venue.id,
  startsAt: p.startsAt,
  ticketTypes: p.ticketTypes,
  ...(p.seating && {
    seating: {
      planId: p.seating.plan.id,
      pricesKopecks: p.seating.pricesKopecks,
      unavailableSeatIds: p.seating.unavailableSeatIds,
    },
  }),
})

export function createPurchaseService({
  orders,
  inventory,
  stock,
  wallet,
  provider,
  statusSecret,
  log,
  now = () => new Date(),
  call,
  holdTtlMs,
  allowPlaceholderPrices = false,
}: Deps) {
  if (!statusSecret) throw new Error('statusSecret is required')
  const lastSync = new Map<string, number>()

  const statusToken = (orderId: string) =>
    createHmac('sha256', statusSecret).update(`order-status:${orderId}`).digest('base64url')
  const validToken = (orderId: string, token: string | null | undefined) => {
    if (!token) return false
    const expected = Buffer.from(statusToken(orderId))
    const given = Buffer.from(token)
    return given.length === expected.length && timingSafeEqual(given, expected)
  }
  const resultUrl = (siteOrigin: string, order: Pick<OrderRow, 'id'>) =>
    `${siteOrigin.replace(/\/$/, '')}/checkout/result?order=${encodeURIComponent(order.id)}&token=${statusToken(order.id)}`

  /** Обращение к банку: таймаут, повтор, метрика отказов (в лог — операция и вид ошибки). */
  const bank = <T>(op: string, fn: (p: PaymentProvider, signal: AbortSignal) => Promise<T>) => {
    const p = provider
    if (!p) throw new Error('payment provider is not configured')
    return callProvider((signal) => fn(p, signal), {
      ...call,
      onFailure: ({ attempt, kind }) =>
        log.warn('payment.provider_failed', { op, provider: p.id, attempt, kind }),
    })
  }

  /** Остатки показа в ядре продаж: нет строк — создать из данных показа (идемпотентно). */
  const ensureInventory = async (performance: SalePerformance) => {
    let missing: boolean
    if (performance.seating) missing = (await stock.seats(performance.id)).length === 0
    else {
      const known = new Set((await stock.inventory(performance.id)).map((r) => r.ticketTypeId))
      missing = performance.ticketTypes.some((t) => !known.has(t.id))
    }
    if (!missing) return
    // Изменение вместимости после начала продаж синхронизирует CMS (хук публикации показа);
    // здесь — только первичное создание строк, чтобы показ можно было купить.
    const synced = await inventory.syncCapacity(
      capacityFromPerformance(capacitySource(performance)),
    )
    if (!synced.ok)
      log.warn('checkout.capacity_conflict', {
        performanceId: performance.id,
        conflicts: synced.conflicts.length,
      })
  }

  const releaseBonus = async (order: OrderRow) => {
    if (!order.customerId || order.bonusKopecks === 0) return
    const released = await wallet.releaseSpend(order.id, now())
    if (released.releasedKopecks > 0)
      log.info('wallet.spend_released', {
        orderId: order.id,
        kopecks: released.releasedKopecks,
      })
  }

  const cancelWithBonus = async (order: OrderRow, reason: string, actor: string) => {
    const cancelled = await orders.cancelOrder(order.id, { actor, reason }, now())
    if (!cancelled.ok)
      log.warn('order.cancel_skipped', { orderId: order.id, error: cancelled.error })
    // Отмена не удалась (заказ уже оплачен) — бонусы не трогаем: их судьбу решит оплата.
    const view = await orders.getOrder(order.id)
    if (view && (view.order.status === 'CANCELLED' || view.order.status === 'EXPIRED'))
      await releaseBonus(view.order)
  }

  /**
   * После подтверждённой оплаты: списание бонусов на месте (при поздней оплате, когда списание
   * уже компенсировано, — повторное, ключ `spend:<orderId>:late`), начисление 3% от оплаченной
   * деньгами стоимости билетов и засчёт друга по «Приведи 3 друга». Каждая операция идемпотентна —
   * вызов из webhook, сверки и worker в любом порядке и количестве даёт один результат.
   */
  async function afterPaid(orderId: string) {
    const view = await orders.getOrder(orderId)
    if (!view || view.order.status !== 'PAID') return
    const { order } = view
    if (!order.customerId) return
    const at = now()
    if (order.bonusKopecks > 0) {
      const state = await wallet.spendStatus(order.id)
      if (state !== 'spent') {
        const ref = state === 'released' ? `${order.id}:late` : order.id
        const spent = await wallet.spend(order.customerId, order.bonusKopecks, ref, at)
        if (!spent.ok)
          log.alert(ALERTS.paymentReview, {
            orderId: order.id,
            reason: 'BONUS_SHORTFALL',
            error: spent.error,
          })
      }
    }
    const accrued = await wallet.accrue(
      order.customerId,
      order.grossKopecks - order.bonusKopecks,
      order.id,
      at,
    )
    const referral = await wallet.qualifyReferral(order.customerId, at)
    if (!accrued.duplicate && accrued.amountKopecks > 0)
      log.info('wallet.accrued', { orderId: order.id, kopecks: accrued.amountKopecks })
    if (referral.qualified)
      log.info('wallet.referral_qualified', { orderId: order.id, rewarded: referral.rewarded })
  }

  /**
   * Применить авторитетный статус платежа от банка. Заказ — из метаданных платежа, сумма
   * и валюта — из ответа банка; содержимому уведомления и адресу возврата не верим.
   */
  async function settle(payment: ProviderPayment, actor: string, correlationId?: string | null) {
    const p = provider!
    if (!payment.orderId) {
      log.alert(ALERTS.paymentReview, {
        reason: 'PAYMENT_WITHOUT_ORDER',
        providerPaymentId: payment.providerPaymentId,
      })
      return 'ignored' as const
    }
    if (payment.status === 'succeeded') {
      const result = await orders.confirmPayment(
        {
          orderId: payment.orderId,
          provider: p.id,
          providerPaymentId: payment.providerPaymentId,
          amountKopecks: payment.amountKopecks,
          currency: payment.currency,
          actor,
          correlationId,
        },
        now(),
      )
      if (result.ok) {
        if (!result.duplicate)
          log.info('order.paid', { orderId: payment.orderId, late: result.late, actor })
        await afterPaid(payment.orderId)
        return 'paid' as const
      }
      if (result.error === 'NEEDS_REVIEW') {
        if (!result.duplicate)
          log.alert(ALERTS.paymentReview, { orderId: payment.orderId, reason: result.reason })
        return 'review' as const
      }
      if (result.error === 'DUPLICATE_PAYMENT') {
        log.alert(ALERTS.paymentReview, {
          orderId: payment.orderId,
          reason: 'DUPLICATE_PAYMENT',
          providerPaymentId: payment.providerPaymentId,
        })
        return 'review' as const
      }
      log.error('payment.unmatched', { orderId: payment.orderId, error: result.error })
      return 'ignored' as const
    }
    if (payment.status === 'canceled') {
      const view = await orders.getOrder(payment.orderId)
      if (!view) return 'ignored' as const
      const { order } = view
      const ours =
        (order.providerPaymentId ?? payment.providerPaymentId) === payment.providerPaymentId
      if (order.status === 'PENDING_PAYMENT' && ours) {
        await cancelWithBonus(order, 'payment_canceled', actor)
        log.info('order.payment_canceled', { orderId: order.id, actor })
      }
      return 'canceled' as const
    }
    return 'pending' as const
  }

  /** Сверка одного ожидающего заказа с банком (страница результата, worker). */
  async function syncOrder(order: OrderRow, actor: string) {
    if (!provider || !order.providerPaymentId || order.paymentProvider !== provider.id) return null
    const payment = await bank('getPayment', (p, signal) =>
      p.getPayment(order.providerPaymentId!, signal),
    )
    if (!payment) return null
    if (payment.orderId !== order.id) {
      log.alert(ALERTS.paymentReview, { orderId: order.id, reason: 'PAYMENT_ORDER_MISMATCH' })
      return null
    }
    return settle(payment, actor)
  }

  /**
   * Оформление (POST /api/checkout). Повтор с тем же ключом не создаёт второй заказ, второе
   * списание и второй платёж: заказ находится по ключу, списание и платёж — по `orderId`.
   */
  async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!provider) return { ok: false, error: 'PAYMENT_UNAVAILABLE' }
    if (!CLIENT_KEY.test(input.clientKey)) return { ok: false, error: 'INVALID_KEY' }
    // Ключ клиента — в пространстве покупателя: чужой ключ не находит чужой заказ.
    const key = `checkout:${input.customerId ?? 'guest'}:${input.clientKey}`
    const email = input.email.trim().toLowerCase()

    let order = await orders.findByIdempotencyKey(key)
    let replay = Boolean(order)
    if (order && (order.customerId !== input.customerId || order.email !== email))
      return { ok: false, error: 'IDEMPOTENCY_CONFLICT' }

    if (!order) {
      const lines = orderLines(input.performance, input.selection)
      if (!lines) return { ok: false, error: 'INVALID_SELECTION' }
      if ((lines.placeholder || SERVICE_FEE.placeholder) && !allowPlaceholderPrices)
        return { ok: false, error: 'PRICES_NOT_APPROVED' }
      const fee = SERVICE_FEE.perTicketKopecks * lines.ticketCount
      const balance = input.customerId ? await wallet.balance(input.customerId, now()) : 0
      // Бонусы — только у вошедшего зрителя; сумма — applyBonus по балансу из базы.
      const bonus = applyBonus({
        ticketsKopecks: lines.ticketsKopecks,
        feeKopecks: fee,
        balanceKopecks: balance,
        requestedKopecks: input.customerId ? input.requestedBonusKopecks : 0,
      })
      await ensureInventory(input.performance)
      const placed = await orders.placeOrder(
        {
          idempotencyKey: key,
          email,
          customerId: input.customerId,
          lines: lines.lines,
          bonusKopecks: bonus.spentKopecks,
          feePerTicketKopecks: SERVICE_FEE.perTicketKopecks,
          holdTtlMs,
          correlationId: input.correlationId,
        },
        now(),
      )
      if (!placed.ok) {
        if (placed.error === 'UNAVAILABLE')
          return { ok: false, error: 'UNAVAILABLE', unavailable: placed.unavailable }
        return { ok: false, error: 'IDEMPOTENCY_CONFLICT' }
      }
      order = placed.order
      replay = placed.duplicate
    }

    const done = (status: OrderStatus, redirectUrl?: string): CheckoutResult => ({
      ok: true,
      replay,
      orderId: order!.id,
      orderNumber: order!.number,
      status,
      amountKopecks: order!.cashKopecks,
      holdUntil: status === 'PENDING_PAYMENT' ? order!.holdUntil : null,
      redirectUrl: redirectUrl ?? resultUrl(input.siteOrigin, order!),
      resultUrl: resultUrl(input.siteOrigin, order!),
    })

    if (order.status !== 'PENDING_PAYMENT') {
      if (order.status === 'EXPIRED' || order.status === 'CANCELLED')
        return { ok: false, error: 'ORDER_CLOSED' }
      return done(order.status)
    }

    // Бонусы списываются до создания платежа: платёж на уменьшенную сумму без списания невозможен.
    if (order.bonusKopecks > 0 && order.customerId) {
      const spent = await wallet.spend(order.customerId, order.bonusKopecks, order.id, now())
      if (!spent.ok) {
        await cancelWithBonus(order, 'bonus_unavailable', 'customer')
        return { ok: false, error: 'BONUS_CHANGED' }
      }
    }

    // Банк — вне DB-транзакций: заказ, бронь и списание уже зафиксированы.
    let created
    try {
      created = await bank('createPayment', (p, signal) =>
        p.createPayment(
          {
            idempotencyKey: `payment:${order!.id}`,
            orderId: order!.id,
            orderNumber: order!.number,
            amountKopecks: order!.cashKopecks,
            currency: order!.currency,
            description: `Билеты театра «Турдус», заказ ${order!.number}`,
            returnUrl: resultUrl(input.siteOrigin, order!),
            method: input.method,
            // Почта для чека — только когда схема чека банка утверждена (T-002).
          },
          signal,
        ),
      )
    } catch (error) {
      if (error instanceof PaymentProviderError && error.kind === 'rejected') {
        log.warn('checkout.payment_rejected', { orderId: order.id })
        await cancelWithBonus(order, 'payment_rejected', 'customer')
        return { ok: false, error: 'PAYMENT_FAILED' }
      }
      // Исход неизвестен: заказ ждёт; повтор с тем же ключом вернёт тот же платёж,
      // а если покупатель не вернётся — бронь истечёт и бонусы вернёт сверка.
      log.warn('checkout.payment_unknown', { orderId: order.id, error: errorInfo(error) })
      return { ok: false, error: 'PAYMENT_RETRY' }
    }

    const attached = await orders.attachPayment(
      order.id,
      { provider: provider.id, providerPaymentId: created.providerPaymentId },
      now(),
    )
    if (!attached) {
      // Заказ успел истечь/оплатиться, пока ждали банк, — перечитать и ответить по факту.
      const view = await orders.getOrder(order.id)
      const status = view?.order.status ?? 'EXPIRED'
      if (status === 'EXPIRED' || status === 'CANCELLED') {
        if (view) await releaseBonus(view.order)
        return { ok: false, error: 'ORDER_CLOSED' }
      }
      if (status !== 'PENDING_PAYMENT') return done(status)
      log.alert(ALERTS.paymentReview, { orderId: order.id, reason: 'SECOND_PAYMENT_CREATED' })
      return { ok: false, error: 'PAYMENT_RETRY' }
    }
    if (created.status === 'succeeded' || !created.confirmationUrl) return done(order.status)
    return done(order.status, created.confirmationUrl)
  }

  /**
   * Статус для страницы результата. Доступ — подписанная ссылка из адреса возврата или сессия
   * владельца. Ожидающий заказ сверяется с банком (не чаще раза в 5 с): так оплата видна, даже
   * если уведомление банка задержалось или потерялось. Статус — только из базы.
   */
  async function orderStatus(
    orderId: string,
    access: { token?: string | null; customerId?: string | null },
  ): Promise<OrderStatusView | null> {
    if (!/^[0-9a-f-]{36}$/.test(orderId)) return null
    let view = await orders.getOrder(orderId)
    if (!view) return null
    const owner = Boolean(access.customerId) && view.order.customerId === access.customerId
    if (!owner && !validToken(orderId, access.token)) return null
    if (view.order.status === 'PENDING_PAYMENT' && view.order.providerPaymentId) {
      const last = lastSync.get(orderId) ?? 0
      if (now().getTime() - last >= STATUS_SYNC_EVERY_MS) {
        lastSync.set(orderId, now().getTime())
        if (lastSync.size > 10_000) lastSync.clear()
        try {
          await syncOrder(view.order, 'status-check')
          view = (await orders.getOrder(orderId)) ?? view
        } catch (error) {
          log.warn('payment.status_sync_failed', { orderId, error: errorInfo(error) })
        }
      }
    }
    const { order, items } = view
    return {
      orderId: order.id,
      orderNumber: order.number,
      status: PUBLIC_STATUS[order.status],
      amountKopecks: order.cashKopecks,
      ticketCount: items.reduce((sum, i) => sum + i.quantity, 0),
      holdUntil: order.status === 'PENDING_PAYMENT' ? order.holdUntil : null,
    }
  }

  /**
   * Уведомление банка (POST /api/payments/webhook/<provider>). Подлинность — по контракту
   * провайдера; событие записывается с дедупликацией; оплата подтверждается только ответом
   * `getPayment`. Дубль доставки обрабатывается так же (всё идемпотентно): падение между записью
   * события и подтверждением не теряет оплату. Банк недоступен — 503, банк повторит доставку.
   */
  async function handleNotification(
    providerId: string,
    request: NotificationRequest,
    correlationId?: string | null,
  ): Promise<NotificationResult> {
    if (!provider || providerId !== provider.id) return { status: 404, body: { code: 'not_found' } }
    const parsed = await provider.parseNotification(request)
    if (!parsed.ok) {
      log.warn('payment.webhook_rejected', { provider: provider.id, error: parsed.error })
      return parsed.error === 'UNAUTHENTICATED'
        ? { status: 401, body: { code: 'unauthenticated' } }
        : { status: 400, body: { code: 'malformed' } }
    }
    if ('ignored' in parsed) return { status: 200, body: { ok: true, ignored: true } }
    const recorded = await orders.recordPaymentEvent(
      {
        provider: provider.id,
        providerPaymentId: parsed.providerPaymentId,
        eventId: parsed.eventId,
        eventType: parsed.eventType,
        payload: { eventType: parsed.eventType },
        correlationId,
      },
      now(),
    )
    if (recorded.duplicate)
      log.info('payment.webhook_duplicate', { provider: provider.id, eventId: parsed.eventId })
    let payment: ProviderPayment | null
    try {
      payment = await bank('getPayment', (p, signal) =>
        p.getPayment(parsed.providerPaymentId, signal),
      )
    } catch {
      return { status: 503, body: { code: 'provider_unavailable' } }
    }
    if (!payment) {
      log.warn('payment.webhook_unknown_payment', { provider: provider.id })
      return { status: 200, body: { ok: true, ignored: true } }
    }
    const outcome = await settle(payment, `provider:${provider.id}`, correlationId)
    return { status: 200, body: { ok: true, outcome, duplicate: recorded.duplicate } }
  }

  /** Сверка перед истечением брони (`expireHolds({ verify })`). */
  const verify = async (order: OrderRow): Promise<PaymentCheck> => {
    if (!order.providerPaymentId) return null
    // Платёж есть, но спросить некого (провайдер отключён) — «неизвестно, ждём» до grace.
    if (!provider || order.paymentProvider !== provider.id) return { status: 'pending' }
    const payment = await bank('getPayment', (p, signal) =>
      p.getPayment(order.providerPaymentId!, signal),
    )
    if (!payment || payment.orderId !== order.id) return { status: 'pending' }
    if (payment.status === 'succeeded')
      return {
        status: 'succeeded',
        provider: provider.id,
        providerPaymentId: payment.providerPaymentId,
        amountKopecks: payment.amountKopecks,
        currency: payment.currency,
      }
    return payment.status === 'canceled' ? { status: 'failed' } : { status: 'pending' }
  }

  /**
   * Сверка (worker, T-045): 1) ожидающие заказы с платежом — статус у банка (потерянные
   * webhook); 2) истечение броней с проверкой у банка; 3) компенсация списанных бонусов
   * у истёкших/отменённых заказов; 4) доначисление бонусов оплаченным (если шаг после оплаты
   * не дошёл). Каждый шаг идемпотентен; сбой одного заказа не останавливает остальные.
   */
  async function reconcile() {
    const at = now()
    const since = (ms: number) => new Date(at.getTime() - ms)
    const stats = { synced: 0, expired: 0, confirmed: 0, released: 0, settled: 0, failed: 0 }
    const guard = async (step: string, orderId: string, fn: () => Promise<unknown>) => {
      try {
        await fn()
        return true
      } catch (error) {
        stats.failed++
        log.warn('payment.reconcile_failed', { step, orderId, error: errorInfo(error) })
        return false
      }
    }

    if (provider) {
      const pending = await orders.ordersInStatus(
        ['PENDING_PAYMENT'],
        since(PENDING_WINDOW_MS),
        SWEEP_LIMIT,
      )
      for (const order of pending) {
        if (!order.providerPaymentId || order.paymentProvider !== provider.id) continue
        if (order.createdAt > since(RECONCILE_AFTER_MS)) continue
        // Просроченные проверит expireHolds — второй запрос к банку не нужен.
        if (order.holdUntil && order.holdUntil <= at) continue
        if (await guard('sync', order.id, () => syncOrder(order, 'worker'))) stats.synced++
      }
    }

    const expiry = await orders.expireHolds(at, { verify })
    stats.expired = expiry.expired
    stats.confirmed = expiry.confirmed

    const closed = await orders.ordersInStatus(
      ['EXPIRED', 'CANCELLED'],
      since(COMPENSATION_WINDOW_MS),
      SWEEP_LIMIT,
    )
    for (const order of closed) {
      if (!order.customerId || order.bonusKopecks === 0) continue
      if (await guard('release', order.id, () => releaseBonus(order))) stats.released++
    }

    const paid = await orders.ordersInStatus(['PAID'], since(SETTLEMENT_WINDOW_MS), SWEEP_LIMIT)
    for (const order of paid) {
      if (!order.customerId) continue
      if (await guard('after_paid', order.id, () => afterPaid(order.id))) stats.settled++
    }
    return stats
  }

  return {
    available: provider !== null,
    providerId: provider?.id ?? null,
    checkout,
    orderStatus,
    handleNotification,
    syncOrder,
    afterPaid,
    reconcile,
    statusToken,
  }
}

export type PurchaseService = ReturnType<typeof createPurchaseService>
