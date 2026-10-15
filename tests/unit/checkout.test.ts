import { describe, expect, it } from 'vitest'

import {
  MAX_TICKETS_PER_ORDER,
  SERVICE_FEE,
  formatPhoneInput,
  parseContact,
  quoteOrder,
  serviceFee,
} from '../../src/modules/checkout'

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

describe('quoteOrder with sold tickets', () => {
  const partlySold = [
    { id: 'std', title: 'Входной', priceKopecks: 100_000, capacity: 20, sold: 17 },
  ]

  it('allows buying up to the remaining tickets', () => {
    expect(quoteOrder(partlySold, { std: 3 }).ok).toBe(true)
  })

  it('rejects more than remain and anything when sold out', () => {
    expect(quoteOrder(partlySold, { std: 4 })).toEqual({ ok: false, error: 'TOO_MANY_TICKETS' })
    const soldOut = [{ ...partlySold[0]!, sold: 20 }]
    expect(quoteOrder(soldOut, { std: 1 })).toEqual({ ok: false, error: 'TOO_MANY_TICKETS' })
  })
})

const valid = { email: 'a@b.ru', consent: true, rulesAccepted: true, payment: 'card' }

describe('parseContact', () => {
  it('normalizes the email and keeps optional fields empty', () => {
    expect(parseContact({ ...valid, email: '  Guest@Mail.RU ' })).toEqual({
      ok: true,
      contact: { email: 'guest@mail.ru', payment: 'card' },
    })
  })

  it('requires a valid email and both consents', () => {
    expect(parseContact({ ...valid, email: 'not-an-email' })).toEqual({
      ok: false,
      errors: { email: 'Проверьте адрес электронной почты' },
    })
    expect(parseContact({ ...valid, consent: false })).toEqual({
      ok: false,
      errors: { consent: 'Нужно согласие на обработку персональных данных' },
    })
    expect(parseContact({ ...valid, rulesAccepted: false })).toEqual({
      ok: false,
      errors: { rulesAccepted: 'Нужно согласиться с правилами продажи и возврата' },
    })
  })

  it('keeps a trimmed name when given', () => {
    expect(parseContact({ ...valid, name: '  Степан Верховенский ' })).toEqual({
      ok: true,
      contact: { email: 'a@b.ru', payment: 'card', name: 'Степан Верховенский' },
    })
  })

  it('normalizes a Russian phone to +7XXXXXXXXXX and rejects incomplete ones', () => {
    for (const phone of ['+7 912 345-67-89', '8 (912) 345-67-89', '9123456789']) {
      expect(parseContact({ ...valid, phone })).toEqual({
        ok: true,
        contact: { email: 'a@b.ru', payment: 'card', phone: '+79123456789' },
      })
    }
    expect(parseContact({ ...valid, phone: '+7 912 345' })).toEqual({
      ok: false,
      errors: { phone: 'Номер телефона: 10 цифр после +7' },
    })
    // Пустая маска — телефон не указан.
    expect(parseContact({ ...valid, phone: '+7' })).toMatchObject({ ok: true })
  })

  it('accepts only known payment methods', () => {
    for (const payment of ['card', 'sbp', 'boxoffice'])
      expect(parseContact({ ...valid, payment })).toMatchObject({ ok: true })
    expect(parseContact({ ...valid, payment: 'crypto' })).toEqual({
      ok: false,
      errors: { payment: 'Выберите способ оплаты' },
    })
  })
})

describe('serviceFee', () => {
  it('charges a flat fee per ticket in kopecks and is flagged as a placeholder', () => {
    expect(SERVICE_FEE.placeholder).toBe(true)
    expect(serviceFee(3)).toBe(3 * SERVICE_FEE.perTicketKopecks)
    expect(serviceFee(0)).toBe(0)
  })
})

describe('formatPhoneInput', () => {
  it('formats typed digits as +7 XXX XXX-XX-XX progressively', () => {
    expect(formatPhoneInput('')).toBe('')
    expect(formatPhoneInput('9')).toBe('+7 9')
    expect(formatPhoneInput('912345')).toBe('+7 912 345')
    expect(formatPhoneInput('+7 912 345-67-89')).toBe('+7 912 345-67-89')
    expect(formatPhoneInput('89123456789')).toBe('+7 912 345-67-89')
  })

  it('treats a leading 8 or 7 as the country code while typing', () => {
    expect(formatPhoneInput('8')).toBe('+7 ')
    expect(formatPhoneInput('8912345')).toBe('+7 912 345')
    // Стирание до «+7» очищает поле.
    expect(formatPhoneInput('+7')).toBe('')
  })

  it('ignores digits beyond the ten-digit number', () => {
    expect(formatPhoneInput('+7 912 345-67-890')).toBe('+7 912 345-67-89')
  })
})
