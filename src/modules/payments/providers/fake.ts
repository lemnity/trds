import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

import {
  PaymentProviderError,
  type CreatePaymentInput,
  type NotificationRequest,
  type ParsedNotification,
  type PaymentProvider,
  type ProviderErrorKind,
  type ProviderPayment,
  type ProviderPaymentStatus,
  type ProviderRefund,
} from '../types'

/**
 * Учебный банк для разработки и тестов (T-043) — НЕ для production: при NODE_ENV=production
 * не создаётся вовсе. Моделирует то, на что опирается домен у настоящего банка: идемпотентное
 * создание платежа по ключу, страницу оплаты, авторитетный статус (server-to-server), подписанное
 * уведомление (HMAC-SHA256 сырого тела) и возврат. Состояние — в памяти процесса.
 *
 * Страница банка — `GET /api/payments/fake/bank?payment=<id>` (dev): «Оплатить», «Отклонить»,
 * «Оплатить без уведомления» (webhook потерян), «Оплатить позже» (после истечения брони).
 */

export const FAKE_PROVIDER_ID = 'fake'
export const FAKE_SIGNATURE_HEADER = 'x-fake-bank-signature'
export const FAKE_BANK_PATH = '/api/payments/fake/bank'

export type FakePayment = {
  id: string
  idempotencyKey: string
  orderId: string
  orderNumber: string
  amountKopecks: number
  currency: string
  description: string
  returnUrl: string
  status: ProviderPaymentStatus
  refundedKopecks: number
  createdAt: Date
  decidedAt: Date | null
}

export type FakeBankState = {
  payments: Map<string, FakePayment>
  byKey: Map<string, string>
  refunds: Map<string, ProviderRefund & { paymentId: string }>
}

export const fakeBankState = (): FakeBankState => ({
  payments: new Map(),
  byKey: new Map(),
  refunds: new Map(),
})

/** Сбои для тестов: следующий вызов операции упадёт (`afterCreate` — платёж создан, ответ потерян). */
export type FakeFault = { kind: ProviderErrorKind; afterCreate?: boolean }

export function createFakeProvider({
  secret,
  state = fakeBankState(),
  now = () => new Date(),
}: {
  /** Секрет подписи уведомлений (dev: из PAYLOAD_SECRET). */
  secret: string
  state?: FakeBankState
  now?: () => Date
}) {
  if (process.env.NODE_ENV === 'production')
    throw new Error('fake payment provider is disabled in production')
  if (!secret) throw new Error('fake provider secret is required')

  const faults: Partial<Record<'create' | 'get' | 'refund' | 'getRefund', FakeFault>> = {}
  /** Как банк отвечает на новый возврат: сразу «выполнен» или «в обработке» (решает `settleRefund`). */
  const refunds = { mode: 'succeeded' as 'succeeded' | 'pending' }
  const takeFault = (op: 'create' | 'get' | 'refund' | 'getRefund') => {
    const fault = faults[op]
    delete faults[op]
    return fault
  }
  const sign = (body: string) => createHmac('sha256', secret).update(body).digest('hex')
  const view = (p: FakePayment): ProviderPayment => ({
    providerPaymentId: p.id,
    orderId: p.orderId,
    status: p.status,
    amountKopecks: p.amountKopecks,
    currency: p.currency,
  })
  const confirmationUrl = (p: FakePayment) =>
    p.status === 'pending'
      ? new URL(`${FAKE_BANK_PATH}?payment=${encodeURIComponent(p.id)}`, p.returnUrl).toString()
      : null

  const provider: PaymentProvider = {
    id: FAKE_PROVIDER_ID,

    async createPayment(input: CreatePaymentInput) {
      const fault = takeFault('create')
      if (fault && !fault.afterCreate) throw new PaymentProviderError(fault.kind, 'fake fault')
      if (!Number.isSafeInteger(input.amountKopecks) || input.amountKopecks <= 0)
        throw new PaymentProviderError('rejected', 'invalid amount')
      const existingId = state.byKey.get(input.idempotencyKey)
      let payment = existingId ? state.payments.get(existingId) : undefined
      if (payment) {
        // Как у банков: тот же ключ с другими параметрами — отказ, а не второй платёж.
        if (payment.orderId !== input.orderId || payment.amountKopecks !== input.amountKopecks)
          throw new PaymentProviderError('rejected', 'idempotency key reused')
      } else {
        payment = {
          id: `fake_${randomUUID()}`,
          idempotencyKey: input.idempotencyKey,
          orderId: input.orderId,
          orderNumber: input.orderNumber,
          amountKopecks: input.amountKopecks,
          currency: input.currency,
          description: input.description,
          returnUrl: input.returnUrl,
          status: 'pending',
          refundedKopecks: 0,
          createdAt: now(),
          decidedAt: null,
        }
        state.payments.set(payment.id, payment)
        state.byKey.set(input.idempotencyKey, payment.id)
      }
      if (fault) throw new PaymentProviderError(fault.kind, 'fake fault after create')
      return {
        providerPaymentId: payment.id,
        status: payment.status,
        confirmationUrl: confirmationUrl(payment),
      }
    },

    async getPayment(providerPaymentId: string) {
      const fault = takeFault('get')
      if (fault) throw new PaymentProviderError(fault.kind, 'fake fault')
      const payment = state.payments.get(providerPaymentId)
      return payment ? view(payment) : null
    },

    async refund(input) {
      const fault = takeFault('refund')
      if (fault && !fault.afterCreate) throw new PaymentProviderError(fault.kind, 'fake fault')
      const done = state.refunds.get(input.idempotencyKey)
      if (done) {
        if (
          done.paymentId !== input.providerPaymentId ||
          done.amountKopecks !== input.amountKopecks
        )
          throw new PaymentProviderError('rejected', 'idempotency key reused')
        if (fault?.afterCreate) throw new PaymentProviderError(fault.kind, 'fake fault')
        return {
          providerRefundId: done.providerRefundId,
          status: done.status,
          amountKopecks: done.amountKopecks,
        }
      }
      const payment = state.payments.get(input.providerPaymentId)
      if (!payment || payment.status !== 'succeeded')
        throw new PaymentProviderError('rejected', 'payment is not refundable')
      if (
        !Number.isSafeInteger(input.amountKopecks) ||
        input.amountKopecks <= 0 ||
        payment.refundedKopecks + input.amountKopecks > payment.amountKopecks
      )
        throw new PaymentProviderError('rejected', 'refund exceeds payment')
      payment.refundedKopecks += input.amountKopecks
      const refund: ProviderRefund = {
        providerRefundId: `fake_refund_${randomUUID()}`,
        status: refunds.mode,
        amountKopecks: input.amountKopecks,
      }
      state.refunds.set(input.idempotencyKey, { ...refund, paymentId: payment.id })
      // Возврат проведён, ответ потерян (таймаут после выполнения) — повтор с тем же ключом.
      if (fault) throw new PaymentProviderError(fault.kind, 'fake fault after refund')
      return refund
    },

    async getRefund(providerRefundId: string) {
      const fault = takeFault('getRefund')
      if (fault) throw new PaymentProviderError(fault.kind, 'fake fault')
      for (const r of state.refunds.values())
        if (r.providerRefundId === providerRefundId)
          return {
            providerRefundId: r.providerRefundId,
            status: r.status,
            amountKopecks: r.amountKopecks,
          }
      return null
    },

    async parseNotification({
      headers,
      rawBody,
    }: NotificationRequest): Promise<ParsedNotification> {
      const signature = headers.get(FAKE_SIGNATURE_HEADER) ?? ''
      const expected = Buffer.from(sign(rawBody), 'hex')
      const given = /^[0-9a-f]{64}$/.test(signature) ? Buffer.from(signature, 'hex') : null
      if (!given || !timingSafeEqual(given, expected))
        return { ok: false, error: 'UNAUTHENTICATED' }
      let body: unknown
      try {
        body = JSON.parse(rawBody)
      } catch {
        return { ok: false, error: 'MALFORMED' }
      }
      const { eventId, type, paymentId } = (body ?? {}) as Record<string, unknown>
      if (typeof type !== 'string') return { ok: false, error: 'MALFORMED' }
      if (!type.startsWith('payment.')) return { ok: true, ignored: true, eventType: type }
      if (typeof eventId !== 'string' || typeof paymentId !== 'string')
        return { ok: false, error: 'MALFORMED' }
      return { ok: true, eventId, eventType: type, providerPaymentId: paymentId }
    },
  }

  /** Действия «покупателя» на странице банка и подписанное уведомление о них. */
  const bank = {
    payment: (id: string) => {
      const p = state.payments.get(id)
      return p ? { ...p } : null
    },
    /** Решение по платежу: только из pending (повтор решения ничего не меняет). */
    decide(id: string, outcome: 'succeeded' | 'canceled') {
      const p = state.payments.get(id)
      if (!p) return null
      if (p.status === 'pending') {
        p.status = outcome
        p.decidedAt = now()
      }
      return { ...p }
    },
    /** Уведомление, как его прислал бы банк: тело и заголовок подписи. */
    notification(id: string, eventId = `evt_${randomUUID()}`) {
      const p = state.payments.get(id)
      if (!p || p.status === 'pending') return null
      const rawBody = JSON.stringify({
        eventId,
        type: `payment.${p.status}`,
        paymentId: p.id,
        // Сумма — как у настоящих банков; домен её не использует, а запрашивает платёж заново.
        amount: p.amountKopecks,
      })
      return { rawBody, headers: { [FAKE_SIGNATURE_HEADER]: sign(rawBody) } }
    },
    /** Подпись произвольного тела (тест подделки уведомления). */
    sign,
    faults,
    refunds,
    /** Решение банка по возврату «в обработке»; отказ возвращает сумму в платёж. */
    settleRefund(providerRefundId: string, outcome: 'succeeded' | 'canceled') {
      for (const r of state.refunds.values()) {
        if (r.providerRefundId !== providerRefundId || r.status !== 'pending') continue
        r.status = outcome
        if (outcome === 'canceled') {
          const p = state.payments.get(r.paymentId)
          if (p) p.refundedKopecks -= r.amountKopecks
        }
        return { ...r }
      }
      return null
    },
  }

  return { provider, bank }
}

export type FakeProvider = ReturnType<typeof createFakeProvider>
export type FakeBank = FakeProvider['bank']
