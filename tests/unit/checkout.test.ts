import { describe, expect, it } from 'vitest'

import { MAX_TICKETS_PER_ORDER, parseContact, quoteOrder } from '../../src/modules/checkout'

const ticketTypes = [
  { id: 'std', title: 'Входной', priceKopecks: 100_000, capacity: 20 },
  { id: 'vip', title: 'Столик', priceKopecks: 250_050, capacity: 4 },
]

describe('quoteOrder', () => {
  it('computes line and order totals in integer kopecks', () => {
    const result = quoteOrder(ticketTypes, { std: 2, vip: 1 })
    expect(result).toEqual({
      ok: true,
      quote: {
        lines: [
          {
            ticketTypeId: 'std',
            title: 'Входной',
            unitPriceKopecks: 100_000,
            quantity: 2,
            totalKopecks: 200_000,
          },
          {
            ticketTypeId: 'vip',
            title: 'Столик',
            unitPriceKopecks: 250_050,
            quantity: 1,
            totalKopecks: 250_050,
          },
        ],
        ticketCount: 3,
        totalKopecks: 450_050,
      },
    })
  })

  it('skips zero quantities', () => {
    const result = quoteOrder(ticketTypes, { std: 1, vip: 0 })
    expect(result.ok && result.quote.lines.map((l) => l.ticketTypeId)).toEqual(['std'])
  })

  it('requires at least one ticket', () => {
    expect(quoteOrder(ticketTypes, { std: 0 })).toEqual({ ok: false, error: 'EMPTY_ORDER' })
  })

  it('rejects unknown ticket types instead of trusting the client', () => {
    expect(quoteOrder(ticketTypes, { fake: 1 })).toEqual({
      ok: false,
      error: 'UNKNOWN_TICKET_TYPE',
    })
  })

  it('rejects fractional or negative quantities', () => {
    expect(quoteOrder(ticketTypes, { std: 1.5 })).toEqual({ ok: false, error: 'INVALID_QUANTITY' })
    expect(quoteOrder(ticketTypes, { std: -1 })).toEqual({ ok: false, error: 'INVALID_QUANTITY' })
  })

  it('limits tickets per order and per category capacity', () => {
    expect(quoteOrder(ticketTypes, { std: MAX_TICKETS_PER_ORDER + 1 })).toEqual({
      ok: false,
      error: 'TOO_MANY_TICKETS',
    })
    expect(quoteOrder(ticketTypes, { vip: 5 })).toEqual({ ok: false, error: 'TOO_MANY_TICKETS' })
  })
})

describe('parseContact', () => {
  it('normalizes the email', () => {
    expect(parseContact({ email: '  Guest@Mail.RU ', consent: true })).toEqual({
      ok: true,
      contact: { email: 'guest@mail.ru' },
    })
  })

  it('requires a valid email and explicit consent', () => {
    expect(parseContact({ email: 'not-an-email', consent: true })).toEqual({
      ok: false,
      errors: { email: 'Проверьте адрес электронной почты' },
    })
    expect(parseContact({ email: 'a@b.ru', consent: false })).toEqual({
      ok: false,
      errors: { consent: 'Нужно согласие на обработку персональных данных' },
    })
  })
})
