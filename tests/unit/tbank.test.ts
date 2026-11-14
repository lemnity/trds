import { describe, expect, it } from 'vitest'

import {
  PaymentConfigError,
  PaymentProviderError,
  createTbankProvider,
  selectPaymentProvider,
  tbankPaymentStatus,
  tbankToken,
  type TbankTransport,
} from '../../src/modules/payments'

const TERMINAL = '1234567890DEMO'
const PASSWORD = 'test-password'
const ORDER = '3f1c2a8e-5b7d-4e2f-9a10-6c4b8d2e1f00'

type Call = { url: string; body: Record<string, unknown> }

/** Подставной банк: отвечает по методу, запоминает запросы. */
function bank(replies: Record<string, unknown>) {
  const calls: Call[] = []
  const transport: TbankTransport = async (url, body) => {
    calls.push({ url, body })
    return { status: 200, json: replies[url.split('/').pop()!] }
  }
  const provider = createTbankProvider({
    terminalKey: TERMINAL,
    password: PASSWORD,
    notificationUrl: 'https://example.test/api/payments/webhook/tbank',
    apiUrl: 'https://bank.test/v2/',
    transport,
  })
  return { provider, calls }
}

const signed = (body: Record<string, unknown>) => ({ ...body, Token: tbankToken(body, PASSWORD) })

describe('tbank token', () => {
  it('matches the request example from the bank docs (nested objects excluded)', () => {
    expect(
      tbankToken(
        {
          TerminalKey: 'MerchantTerminalKey',
          Amount: 19200,
          OrderId: '00000',
          Description: 'Подарочная карта на 1000 рублей',
          DATA: { Phone: '+71234567890' },
          Receipt: { Items: [] },
        },
        '11111111111111',
      ),
    ).toBe('72dd466f8ace0a37a1f740ce5fb78101712bc0665d91a8108c7c8a0ccd426db2')
  })

  it('matches the notification example from the bank docs (boolean as "true")', () => {
    expect(
      tbankToken(
        {
          TerminalKey: '1234567890DEMO',
          OrderId: '000000',
          Success: true,
          Status: 'AUTHORIZED',
          PaymentId: '0000000',
          ErrorCode: '0',
          Amount: '1111',
          CardId: '000000',
          Pan: '200000******0000',
          ExpDate: '1111',
          RebillId: '000000',
        },
        '11111111111',
      ),
    ).toBe('1c0964277d0213349243065a0d5b838b8e90d2d25f740d0f2767836e710e80c8')
  })
})

describe('tbank status mapping', () => {
  it('one-stage success is CONFIRMED; AUTHORIZED is not paid yet', () => {
    expect(tbankPaymentStatus('CONFIRMED')).toBe('succeeded')
    expect(tbankPaymentStatus('REFUNDED')).toBe('succeeded')
    expect(tbankPaymentStatus('AUTHORIZED')).toBe('pending')
    expect(tbankPaymentStatus('NEW')).toBe('pending')
    expect(tbankPaymentStatus('REJECTED')).toBe('canceled')
    expect(tbankPaymentStatus('DEADLINE_EXPIRED')).toBe('canceled')
    expect(tbankPaymentStatus('SOMETHING_NEW')).toBe('pending')
  })
})

describe('tbank provider', () => {
  const payment = {
    idempotencyKey: `payment:${ORDER}`,
    orderId: ORDER,
    orderNumber: 'T-1',
    amountKopecks: 150000,
    currency: 'RUB' as const,
    description: 'Билеты театра «Турдус», заказ T-1',
    returnUrl: 'https://example.test/checkout/result?order=1',
  }

  it('Init: signed request with order id, amount in kopecks and webhook url', async () => {
    const { provider, calls } = bank({
      Init: {
        Success: true,
        ErrorCode: '0',
        PaymentId: 777,
        Status: 'NEW',
        PaymentURL: 'https://pay.test/f/1',
      },
    })
    expect(await provider.createPayment(payment)).toEqual({
      providerPaymentId: '777',
      status: 'pending',
      confirmationUrl: 'https://pay.test/f/1',
    })
    const { url, body } = calls[0]!
    expect(url).toBe('https://bank.test/v2/Init')
    expect(body).toMatchObject({
      TerminalKey: TERMINAL,
      Amount: 150000,
      OrderId: ORDER,
      NotificationURL: 'https://example.test/api/payments/webhook/tbank',
      SuccessURL: payment.returnUrl,
    })
    const { Token, ...rest } = body
    expect(Token).toBe(tbankToken(rest, PASSWORD))
  })

  it('bank refusal is rejected (not retried) and carries only the error code', async () => {
    const { provider } = bank({
      Init: { Success: false, ErrorCode: '204', Message: 'Неверный токен', Details: 'x' },
    })
    const error = await provider.createPayment(payment).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PaymentProviderError)
    expect(error).toMatchObject({ kind: 'rejected', message: 'tbank Init error 204' })
  })

  it('network failure and 5xx are unavailable (safe to retry)', async () => {
    const failing = createTbankProvider({
      terminalKey: TERMINAL,
      password: PASSWORD,
      notificationUrl: 'https://example.test/w',
      transport: async () => {
        throw new Error('ECONNRESET')
      },
    })
    await expect(failing.getPayment('1')).rejects.toMatchObject({ kind: 'unavailable' })
    const down = createTbankProvider({
      terminalKey: TERMINAL,
      password: PASSWORD,
      notificationUrl: 'https://example.test/w',
      transport: async () => ({ status: 502, json: null }),
    })
    await expect(down.getPayment('1')).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('GetState is the authoritative payment: order, status, amount', async () => {
    const { provider, calls } = bank({
      GetState: {
        Success: true,
        ErrorCode: '0',
        PaymentId: '777',
        OrderId: ORDER,
        Status: 'CONFIRMED',
        Amount: 150000,
      },
    })
    expect(await provider.getPayment('777')).toEqual({
      providerPaymentId: '777',
      orderId: ORDER,
      status: 'succeeded',
      amountKopecks: 150000,
      currency: 'RUB',
    })
    expect(calls[0]!.body).toMatchObject({ PaymentId: '777' })
  })

  it('refund is Cancel with ExternalRequestId = idempotency key; stable refund id', async () => {
    const { provider, calls } = bank({
      Cancel: { Success: true, ErrorCode: '0', Status: 'PARTIAL_REFUNDED', PaymentId: '777' },
    })
    const input = {
      idempotencyKey: 'refund:abc',
      providerPaymentId: '777',
      amountKopecks: 50000,
      currency: 'RUB' as const,
    }
    const first = await provider.refund(input)
    const again = await provider.refund(input)
    expect(first).toEqual({
      providerRefundId: '777:refund:abc',
      status: 'succeeded',
      amountKopecks: 50000,
    })
    expect(again.providerRefundId).toBe(first.providerRefundId)
    expect(calls[0]!.body).toMatchObject({
      PaymentId: '777',
      Amount: 50000,
      ExternalRequestId: 'refund:abc',
    })
  })
})

describe('tbank notifications', () => {
  const { provider } = bank({})
  const parse = (body: unknown) =>
    provider.parseNotification({ headers: new Headers(), rawBody: JSON.stringify(body) })
  const event = {
    TerminalKey: TERMINAL,
    OrderId: ORDER,
    Success: true,
    Status: 'CONFIRMED',
    PaymentId: 777,
    ErrorCode: '0',
    Amount: 150000,
    Pan: '430000******0777',
  }

  it('accepts a correctly signed notification; event id is payment + status', async () => {
    expect(await parse(signed(event))).toEqual({
      ok: true,
      eventId: '777:CONFIRMED',
      eventType: 'CONFIRMED',
      providerPaymentId: '777',
    })
  })

  it('rejects a wrong token, a tampered field or another terminal', async () => {
    const unauthenticated = { ok: false, error: 'UNAUTHENTICATED' }
    expect(await parse({ ...event, Token: '0'.repeat(64) })).toEqual(unauthenticated)
    expect(await parse({ ...signed(event), Amount: 1 })).toEqual(unauthenticated)
    expect(await parse(signed({ ...event, TerminalKey: 'OTHER' }))).toEqual(unauthenticated)
  })

  it('malformed body or missing token is MALFORMED', async () => {
    expect(
      await provider.parseNotification({ headers: new Headers(), rawBody: 'not json' }),
    ).toEqual({ ok: false, error: 'MALFORMED' })
    expect(await parse(event)).toEqual({ ok: false, error: 'MALFORMED' })
  })

  it('ignores non-payment notifications (card binding)', async () => {
    expect(
      await parse(signed({ TerminalKey: TERMINAL, NotificationType: 'LINKCARD', Status: 'X' })),
    ).toEqual({ ok: true, ignored: true, eventType: 'LINKCARD' })
  })
})

describe('selectPaymentProvider: tbank', () => {
  const env = {
    PAYMENT_PROVIDER: 'tbank',
    TBANK_TERMINAL_KEY: TERMINAL,
    TBANK_PASSWORD: PASSWORD,
    PUBLIC_SITE_URL: 'https://example.test/',
    NODE_ENV: 'production',
  }

  it('is allowed in production and has no dev bank', () => {
    const selection = selectPaymentProvider(env)
    expect(selection?.provider.id).toBe('tbank')
    expect(selection?.fakeBank).toBeNull()
  })

  it('only a DEMO terminal is test mode (unapproved prices allowed); a live one is not', () => {
    expect(selectPaymentProvider(env)?.testMode).toBe(true)
    expect(selectPaymentProvider({ ...env, TBANK_TERMINAL_KEY: '1234567890' })?.testMode).toBe(
      false,
    )
  })

  it('refuses to start without credentials or an https site url', () => {
    expect(() => selectPaymentProvider({ ...env, TBANK_PASSWORD: '' })).toThrow(PaymentConfigError)
    expect(() => selectPaymentProvider({ ...env, PUBLIC_SITE_URL: 'http://example.test' })).toThrow(
      PaymentConfigError,
    )
  })
})
