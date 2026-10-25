import { NextRequest } from 'next/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { TicketsService } from '../../src/modules/tickets/service'
import { ALICE, BOB, PAYLOAD_SECRET, lookup, memoryCommerce } from './tickets-fixture'

// Маршруты T-046/T-051: customerId — только из серверной сессии; чужой билет — 404.
const holder = vi.hoisted(() => ({
  service: null as TicketsService | null,
  sessions: {} as Record<string, string>,
}))

vi.mock('@/modules/accounts', () => ({
  SESSION_COOKIE: 'turdus_session',
  getAccounts: async () => ({
    auth: {
      getSession: async (token: string | undefined) =>
        token && holder.sessions[token] ? { customer: { id: holder.sessions[token] } } : null,
    },
  }),
}))

vi.mock('@/modules/tickets', async () => {
  const qr = await import('../../src/modules/tickets/qr')
  return { ...qr, getTickets: async () => holder.service! }
})

const { GET: listTickets } = await import('../../src/app/api/account/tickets/route')
const { GET: ticketDetail } = await import('../../src/app/api/account/tickets/[number]/route')
const { GET: ticketQr } = await import('../../src/app/api/tickets/[number]/qr/route')

const request = (path: string, session?: string) =>
  new NextRequest(`http://localhost${path}`, {
    headers: session ? { cookie: `turdus_session=${session}` } : {},
  })
const ctx = (number: string) => ({ params: Promise.resolve({ number }) })

let aliceTicket = ''
let qrLink = ''

beforeAll(async () => {
  const { ticketSecretFrom } = await import('../../src/modules/tickets/token')
  const { memoryTicketsStore } = await import('../../src/modules/tickets/memoryStore')
  const { createTicketsService } = await import('../../src/modules/tickets/service')
  const secret = ticketSecretFrom(PAYLOAD_SECRET)
  const c = await memoryCommerce(secret)
  holder.service = createTicketsService({
    store: memoryTicketsStore(c.store),
    secret,
    performances: () => lookup,
  })
  const { tickets } = await c.buy(ALICE, 'p-future', 1)
  await c.buy(BOB, 'p-future', 2)
  aliceTicket = tickets[0]!.number
  qrLink = holder.service.qrLink('http://localhost', tickets[0]!)
  holder.sessions = { 'alice-session': ALICE, 'bob-session': BOB }
})

describe('GET /api/account/tickets', () => {
  it('401 without a session, in the common error format', async () => {
    const res = await listTickets(request('/api/account/tickets'))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({
      code: 'unauthorized',
      correlationId: expect.any(String),
    })
  })

  it('returns only the session customer tickets; a customerId in the query is ignored', async () => {
    const res = await listTickets(
      request(`/api/account/tickets?customerId=${ALICE}`, 'bob-session'),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const body = (await res.json()) as { upcoming: { number: string }[] }
    expect(body.upcoming).toHaveLength(2)
    expect(body.upcoming.map((t) => t.number)).not.toContain(aliceTicket)
    expect(JSON.stringify(body)).not.toMatch(/@example\.com|tokenHash|token/)
  })
})

describe('GET /api/account/tickets/<number>', () => {
  it('owner gets the ticket with its order; another customer gets 404', async () => {
    const own = await ticketDetail(
      request(`/api/account/tickets/${aliceTicket}`, 'alice-session'),
      ctx(aliceTicket),
    )
    expect(own.status).toBe(200)
    expect(await own.json()).toMatchObject({
      ticket: { number: aliceTicket, state: 'valid' },
      order: { status: 'PAID', ticketNumbers: [aliceTicket] },
    })
    const foreign = await ticketDetail(
      request(`/api/account/tickets/${aliceTicket}`, 'bob-session'),
      ctx(aliceTicket),
    )
    expect(foreign.status).toBe(404)
    const missing = await ticketDetail(
      request('/api/account/tickets/TRD-ZZZZZZZZ-01', 'bob-session'),
      ctx('TRD-ZZZZZZZZ-01'),
    )
    expect(await missing.json()).toMatchObject({ code: (await foreign.json()).code })
  })
})

describe('GET /api/tickets/<number>/qr', () => {
  it('owner gets SVG and PNG; no-store, no referrer', async () => {
    const svg = await ticketQr(
      request(`/api/tickets/${aliceTicket}/qr?format=svg`, 'alice-session'),
      ctx(aliceTicket),
    )
    expect(svg.status).toBe(200)
    expect(svg.headers.get('content-type')).toContain('image/svg+xml')
    expect(svg.headers.get('cache-control')).toBe('private, no-store')
    expect(svg.headers.get('referrer-policy')).toBe('no-referrer')
    const png = await ticketQr(
      request(`/api/tickets/${aliceTicket}/qr`, 'alice-session'),
      ctx(aliceTicket),
    )
    expect(png.headers.get('content-type')).toBe('image/png')
    expect(
      Buffer.from(await png.arrayBuffer())
        .subarray(1, 4)
        .toString(),
    ).toBe('PNG')
  })

  it('another customer and anonymous requests do not get the QR', async () => {
    const foreign = await ticketQr(
      request(`/api/tickets/${aliceTicket}/qr`, 'bob-session'),
      ctx(aliceTicket),
    )
    expect(foreign.status).toBe(404)
    const anonymous = await ticketQr(request(`/api/tickets/${aliceTicket}/qr`), ctx(aliceTicket))
    expect(anonymous.status).toBe(401)
  })

  it('signed email link works without a session; a tampered one is 404', async () => {
    const url = new URL(qrLink)
    const ok = await ticketQr(request(`${url.pathname}${url.search}`), ctx(aliceTicket))
    expect(ok.status).toBe(200)
    const bad = new URL(qrLink)
    bad.searchParams.set('sig', 'A'.repeat(32))
    expect((await ticketQr(request(`${bad.pathname}${bad.search}`), ctx(aliceTicket))).status).toBe(
      404,
    )
    bad.searchParams.set('sig', 'short')
    expect((await ticketQr(request(`${bad.pathname}${bad.search}`), ctx(aliceTicket))).status).toBe(
      400,
    )
  })
})
