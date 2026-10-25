import { inflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { ticketIcs, icsEscape, icsFold } from '../../src/components/account/ticket-calendar'
import { demoAccountTickets } from '../../src/components/account/tickets-demo'
import { memoryTicketsStore } from '../../src/modules/tickets/memoryStore'
import { qrMatrix, qrPng, qrSvg } from '../../src/modules/tickets/qr'
import { createTicketsService } from '../../src/modules/tickets/service'
import type { TicketRecord, TicketsStore } from '../../src/modules/tickets/store'
import {
  TICKET_NUMBER_FORMAT,
  TICKET_TOKEN_FORMAT,
  hashTicketToken,
  signQrLink,
  ticketSecretFrom,
  ticketToken,
} from '../../src/modules/tickets/token'
import { groupTickets, ticketState, toTicketView } from '../../src/modules/tickets/views'
import {
  ALICE,
  BOB,
  NOW,
  PAYLOAD_SECRET,
  lookup,
  memoryCommerce,
  showsData,
} from './tickets-fixture'

// T-046 (билеты и QR), T-051 («Мои билеты»): токен без ПД, доступ только владельцу, статусы.
const secret = ticketSecretFrom(PAYLOAD_SECRET)

const setup = async () => {
  const c = await memoryCommerce(secret)
  const store = memoryTicketsStore(c.store)
  const service = createTicketsService({ store, secret, performances: () => lookup })
  return { ...c, ticketsStore: store, service }
}

/** Прочитать PNG (8 бит серый, фильтр None) и снять матрицу модулей по центрам клеток. */
const decodePngMatrix = (png: Buffer, scale: number, quiet = 4) => {
  const side = png.readUInt32BE(16)
  let offset = 8
  const idat: Buffer[] = []
  while (offset < png.length) {
    const len = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    if (type === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + len))
    offset += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const modules = side / scale - quiet * 2
  const dark = (r: number, c: number) => {
    const y = (r + quiet) * scale + Math.floor(scale / 2)
    const x = (c + quiet) * scale + Math.floor(scale / 2)
    return raw[y * (side + 1) + 1 + x] === 0
  }
  return { modules, dark }
}

describe('ticket token (T-046)', () => {
  it('matches the token issued by the order service and the stored hash', async () => {
    const { buy, orders } = await setup()
    const { tickets } = await buy(ALICE, 'p-future', 2)
    for (const t of tickets) {
      const token = ticketToken(secret, t)
      expect(token).toBe(orders.ticketToken(t))
      expect(hashTicketToken(token)).toBe(t.tokenHash)
      expect(token).toMatch(TICKET_TOKEN_FORMAT)
      expect(t.number).toMatch(TICKET_NUMBER_FORMAT)
    }
  })

  it('contains no personal data or order details', async () => {
    const { buy } = await setup()
    const { order, tickets } = await buy(ALICE, 'p-future', 1)
    const token = ticketToken(secret, tickets[0]!)
    for (const leak of [order.email, '@', order.number, tickets[0]!.number, ALICE, tickets[0]!.id])
      expect(token).not.toContain(leak)
    // Другая версия токена (ротация) — другой токен.
    expect(ticketToken(secret, { ...tickets[0]!, tokenVersion: 2 })).not.toBe(token)
  })
})

describe('QR image (T-046)', () => {
  const token = ticketToken(secret, { id: '0b6f0c3e-5d1a-4f7e-9d5b-1f2e3d4c5b6a', tokenVersion: 1 })

  it('PNG encodes exactly the token QR matrix', () => {
    const png = qrPng(token, 4)
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
    const expected = qrMatrix(token)
    const decoded = decodePngMatrix(png, 4)
    expect(decoded.modules).toBe(expected.size)
    for (let r = 0; r < expected.size; r++)
      for (let c = 0; c < expected.size; c++) expect(decoded.dark(r, c)).toBe(expected.dark(r, c))
  })

  it('QR of a different string differs (the image carries the content, not a constant)', () => {
    const a = qrMatrix(token)
    const b = qrMatrix(`${token.slice(0, -1)}A`)
    let diff = 0
    for (let r = 0; r < a.size; r++)
      for (let c = 0; c < a.size; c++) if (a.dark(r, c) !== b.dark(r, c)) diff++
    expect(diff).toBeGreaterThan(0)
  })

  it('SVG is self-contained, white background, escaped title', () => {
    const svg = qrSvg(token, 'Билет <TRD>')
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('<title>Билет TRD</title>')
    expect(svg).not.toContain(token)
    expect(svg).not.toMatch(/<script|href=/i)
  })
})

describe('owner-only access (T-051, ACCOUNT-02)', () => {
  it('lists only the session customer tickets; another customer sees nothing', async () => {
    const { buy, service } = await setup()
    await buy(ALICE, 'p-future', 2, { bonus: 30_000 })
    await buy(BOB, 'p-future', 1)
    await buy(null, 'p-future', 1)

    const alice = await service.accountTickets(ALICE, NOW)
    expect(alice.upcoming).toHaveLength(2)
    expect(alice.orders).toHaveLength(1)
    expect(alice.orders[0]).toMatchObject({
      bonusKopecks: 30_000,
      cashKopecks: 270_000,
      status: 'PAID',
    })
    const bob = await service.accountTickets(BOB, NOW)
    expect(bob.upcoming).toHaveLength(1)
    expect(bob.upcoming[0]!.orderNumber).not.toBe(alice.upcoming[0]!.orderNumber)
    expect(await service.accountTickets('33333333-3333-4333-8333-333333333333', NOW)).toEqual({
      upcoming: [],
      past: [],
      refunded: [],
      orders: [],
    })
  })

  it('ticket detail and QR of another customer are indistinguishable from a missing ticket', async () => {
    const { buy, service } = await setup()
    const { tickets } = await buy(ALICE, 'p-future', 1)
    const number = tickets[0]!.number

    expect(await service.ticketForCustomer(BOB, number, NOW)).toBeNull()
    expect(await service.qrFor({ number, customerId: BOB })).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(await service.qrFor({ number, customerId: null })).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(await service.qrFor({ number: 'TRD-AAAAAAAA-01', customerId: BOB })).toEqual({
      ok: false,
      reason: 'not_found',
    })

    const own = await service.ticketForCustomer(ALICE, number, NOW)
    expect(own?.ticket).toMatchObject({ number, state: 'valid', venue: { title: 'Бар «Тест»' } })
    expect(own?.order?.ticketNumbers).toEqual([number])
    expect(await service.qrFor({ number, customerId: ALICE })).toEqual({
      ok: true,
      number,
      token: ticketToken(secret, tickets[0]!),
    })
  })

  it('signed email link opens the QR without a session; a wrong or foreign signature does not', async () => {
    const { buy, service } = await setup()
    const [a] = (await buy(ALICE, 'p-future', 1)).tickets
    const [b] = (await buy(BOB, 'p-future', 1)).tickets
    const link = new URL(service.qrLink('https://teatrturdus.ru/', a!))
    expect(link.pathname).toBe(`/api/tickets/${a!.number}/qr`)
    expect(link.search).not.toContain(ticketToken(secret, a!))
    const sig = link.searchParams.get('sig')!
    expect(await service.qrFor({ number: a!.number, signature: sig })).toMatchObject({ ok: true })
    expect(await service.qrFor({ number: b!.number, signature: sig })).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(await service.qrFor({ number: a!.number, signature: 'x'.repeat(32) })).toEqual({
      ok: false,
      reason: 'not_found',
    })
    // Подпись другого секрета не подходит.
    expect(
      await service.qrFor({ number: a!.number, signature: signQrLink('other-secret', a!) }),
    ).toEqual({ ok: false, reason: 'not_found' })
  })
})

const record = (over: Partial<TicketRecord> = {}): TicketRecord => ({
  id: '0b6f0c3e-5d1a-4f7e-9d5b-1f2e3d4c5b6a',
  number: 'TRD-ABCDEFGH-01',
  orderId: 'o1',
  orderNumber: 'TRD-ABCDEFGH',
  orderStatus: 'PAID',
  customerId: ALICE,
  performanceId: 'p-future',
  ticketTypeId: 'std',
  seatId: null,
  categoryTitle: 'Входной',
  status: 'ISSUED',
  tokenVersion: 1,
  priceKopecks: 150_000,
  bonusKopecks: 0,
  cashKopecks: 150_000,
  feeKopecks: 0,
  issuedAt: NOW,
  refundedAt: null,
  ...over,
})

const fakeStore = (rows: TicketRecord[]): TicketsStore => ({
  ticketsOfCustomer: async (id) => rows.filter((r) => r.customerId === id),
  ordersOfCustomer: async () => [],
  ticketByNumber: async (n) => rows.find((r) => r.number === n) ?? null,
  ticketByTokenHash: async (h) =>
    rows.find((r) => hashTicketToken(ticketToken(secret, r)) === h) ?? null,
  orderForNotice: async () => null,
  refundForNotice: async () => null,
})

describe('ticket statuses', () => {
  it('maps server statuses to states', () => {
    expect(ticketState(record())).toBe('valid')
    expect(ticketState(record({ orderStatus: 'PARTIALLY_REFUNDED' }))).toBe('valid')
    expect(ticketState(record({ status: 'REFUND_PENDING' }))).toBe('refund_pending')
    expect(ticketState(record({ status: 'REFUNDED', refundedAt: NOW }))).toBe('refunded')
    expect(ticketState(record({ orderStatus: 'NEEDS_REVIEW' }))).toBe('cancelled')
    expect(ticketState(record({ orderStatus: 'CANCELLED' }))).toBe('cancelled')
  })

  it('refunded, pending refund and cancelled tickets get no QR and show as invalid', async () => {
    const rows = [
      record({ number: 'TRD-ABCDEFGH-01', status: 'REFUNDED', refundedAt: NOW }),
      record({
        id: '1b6f0c3e-5d1a-4f7e-9d5b-1f2e3d4c5b6a',
        number: 'TRD-ABCDEFGH-02',
        status: 'REFUND_PENDING',
      }),
      record({
        id: '2b6f0c3e-5d1a-4f7e-9d5b-1f2e3d4c5b6a',
        number: 'TRD-ABCDEFGH-03',
        orderStatus: 'NEEDS_REVIEW',
      }),
    ]
    const service = createTicketsService({
      store: fakeStore(rows),
      secret,
      performances: () => lookup,
    })
    for (const r of rows) {
      const qr = await service.qrFor({ number: r.number, customerId: ALICE })
      expect(qr).toMatchObject({ ok: false, reason: 'invalid' })
      const check = await service.verifyTicketToken(ticketToken(secret, r))
      expect(check).toMatchObject({ ok: true, valid: false })
    }
    const account = await service.accountTickets(ALICE, NOW)
    expect(account.upcoming).toEqual([])
    expect(account.refunded.map((t) => [t.state, t.qrUrl])).toEqual(
      expect.arrayContaining([
        ['refunded', null],
        ['refund_pending', null],
        ['cancelled', null],
      ]),
    )
  })

  it('groups upcoming (soonest first), past and refunded; past tickets have no QR', () => {
    const views = [
      record({ number: 'TRD-AAAAAAAA-01', performanceId: 'p-past' }),
      record({ number: 'TRD-AAAAAAAA-02', performanceId: 'p-future' }),
      record({ number: 'TRD-AAAAAAAA-03', performanceId: 'removed-from-afisha' }),
      record({ number: 'TRD-AAAAAAAA-04', status: 'REFUNDED', refundedAt: NOW }),
    ].map((r) => toTicketView(r, lookup, NOW))
    const g = groupTickets(views, NOW)
    expect(g.upcoming.map((t) => t.number)).toEqual(['TRD-AAAAAAAA-02', 'TRD-AAAAAAAA-03'])
    expect(g.past.map((t) => [t.number, t.qrUrl])).toEqual([['TRD-AAAAAAAA-01', null]])
    expect(g.refunded.map((t) => t.number)).toEqual(['TRD-AAAAAAAA-04'])
    expect(g.upcoming[0]).toMatchObject({
      startsAt: '2026-11-20T19:00:00+05:00',
      endsAt: '2026-11-20T16:00:00.000Z',
      venue: { address: 'Екатеринбург, ул. Тестовая, 1' },
      qrUrl: '/api/tickets/TRD-AAAAAAAA-02/qr?format=svg',
    })
    // Показ снят с афиши — билет не теряется, дата «уточняется».
    expect(g.upcoming[1]).toMatchObject({ show: null, startsAt: null, qrUrl: expect.any(String) })
  })

  it('labels seats from the hall plan id', () => {
    const v = toTicketView(record({ seatId: 'r3-s12' }), lookup, NOW)
    expect(v.seat).toBe('Ряд 3, место 12')
  })
})

describe('verifyTicketToken (future entrance scanning)', () => {
  it('accepts a valid token and reveals no personal data', async () => {
    const { buy, service } = await setup()
    const [t] = (await buy(ALICE, 'p-future', 1)).tickets
    const check = await service.verifyTicketToken(ticketToken(secret, t!))
    expect(check).toEqual({
      ok: true,
      valid: true,
      state: 'valid',
      ticket: {
        number: t!.number,
        performanceId: 'p-future',
        ticketTypeId: 'std',
        seatId: null,
        startsAt: '2026-11-20T19:00:00+05:00',
      },
    })
    expect(JSON.stringify(check)).not.toMatch(/@|example\.com/)
  })

  it('rejects malformed, forged and other-secret tokens', async () => {
    const { buy, service } = await setup()
    const [t] = (await buy(ALICE, 'p-future', 1)).tickets
    expect(await service.verifyTicketToken('not a token')).toEqual({
      ok: false,
      reason: 'malformed',
    })
    expect(await service.verifyTicketToken('A'.repeat(43))).toEqual({
      ok: false,
      reason: 'unknown',
    })
    expect(await service.verifyTicketToken(ticketToken('another-secret', t!))).toEqual({
      ok: false,
      reason: 'unknown',
    })
  })
})

describe('calendar .ics (T-051)', () => {
  const view = toTicketView(record({ seatId: 'r3-s12' }), lookup, NOW)

  it('builds a valid single-event iCalendar in UTC without personal data', () => {
    const ics = ticketIcs(view, { now: NOW, siteUrl: 'https://teatrturdus.ru' })!
    expect(ics.endsWith('\r\n')).toBe(true)
    const lines = ics.split('\r\n')
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(ics).toContain('DTSTART:20261120T140000Z')
    expect(ics).toContain('DTEND:20261120T160000Z')
    expect(ics).toContain('UID:TRD-ABCDEFGH-01@teatrturdus.ru')
    // «;» и «,» в названии экранированы.
    expect(ics.replace(/\r\n /g, '')).toContain('SUMMARY:Габи\\; спектакль\\, с запятой')
    expect(ics.replace(/\r\n /g, '')).toContain(
      'LOCATION:Бар «Тест»\\, Екатеринбург\\, ул. Тестовая\\, 1',
    )
    expect(ics).not.toMatch(/@example|ATTENDEE|ORGANIZER/)
    // Каждая строка не длиннее 75 октетов.
    for (const line of lines) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)
  })

  it('folds by octets without splitting a character and escapes text', () => {
    const long = `DESCRIPTION:${'ёжик '.repeat(30)}`
    const folded = icsFold(long)
    for (const part of folded.split('\r\n')) expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75)
    expect(folded.replace(/\r\n /g, '')).toBe(long)
    expect(icsEscape('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne')
  })

  it('has no calendar file for a ticket without a date', () => {
    expect(
      ticketIcs({ ...view, startsAt: null, endsAt: null }, { now: NOW, siteUrl: 'x' }),
    ).toBeNull()
  })
})

describe('demo tickets on the static preview', () => {
  it('uses real preview performances, marked demo numbers and no token', () => {
    const demo = demoAccountTickets(NOW, showsData)
    expect(demo.upcoming).toHaveLength(2)
    expect(demo.past).toHaveLength(1)
    expect(demo.refunded[0]).toMatchObject({ state: 'refunded' })
    for (const t of [...demo.upcoming, ...demo.past, ...demo.refunded]) {
      expect(t.number).toMatch(/^TRD-DEMO\d{4}-\d{2}$/)
      expect(t.qrUrl).toBeNull()
    }
    expect(demo.orders[0]).toMatchObject({ bonusKopecks: 6_000, cashKopecks: 294_000 })
  })
})
