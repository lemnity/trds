import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'

import { sql } from '@payloadcms/db-postgres/drizzle'
import { drizzle } from '@payloadcms/db-postgres/drizzle/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { accountsTables } from '../../src/db/schema/accounts'
import { commerceTables } from '../../src/db/schema/commerce'
import { createLogger } from '../../src/lib/log'
import {
  EmailSendError,
  OUTBOX_RULES,
  createOutboxProcessor,
  type EmailMessage,
  type EmailProvider,
} from '../../src/modules/email'
import { pgOutboxQueue } from '../../src/modules/email/pgOutbox'
import { createSmtpProvider } from '../../src/modules/email/smtp'
import { pgCommerceStore } from '../../src/modules/inventory/pgStore'
import { ticketNotificationHandlers } from '../../src/modules/tickets/notifications'
import { pgTicketsStore } from '../../src/modules/tickets/pgStore'
import { createTicketsService } from '../../src/modules/tickets/service'
import { hashTicketToken, ticketSecretFrom, ticketToken } from '../../src/modules/tickets/token'
import { ALICE, BOB, NOW, PAYLOAD_SECRET, commerce, lookup } from './tickets-fixture'

/**
 * Билеты, кабинет и outbox писем на настоящем PostgreSQL (T-046/T-047/T-051). Только с
 * TICKETS_PG_URL — ОДНОРАЗОВАЯ база: схема public пересоздаётся. Например:
 *   docker run --rm -d --name trds-tickets-test -p 127.0.0.1:55434:5432 \
 *     -e POSTGRES_PASSWORD=x postgres:16.15-alpine
 *   TICKETS_PG_URL=postgres://postgres:x@127.0.0.1:55434/postgres pnpm vitest run tickets-pg
 * Необязательно — настоящая отправка через SMTP в одноразовый Mailpit:
 *   docker run --rm -d --name trds-mailpit-test -p 127.0.0.1:51025:1025 -p 127.0.0.1:58025:8025 axllent/mailpit
 *   TICKETS_SMTP_PORT=51025 TICKETS_MAILPIT_API=http://127.0.0.1:58025 …
 */
const url = process.env.TICKETS_PG_URL
const smtpPort = process.env.TICKETS_SMTP_PORT
const mailpitApi = process.env.TICKETS_MAILPIT_API

describe.skipIf(!url)('tickets, account and email outbox on PostgreSQL', () => {
  const db = drizzle({ connection: { connectionString: url!, max: 20 } })
  const secret = ticketSecretFrom(PAYLOAD_SECRET)
  const store = pgTicketsStore(db as unknown as Parameters<typeof pgTicketsStore>[0])
  const service = createTicketsService({ store, secret, performances: () => lookup })
  const queue = pgOutboxQueue(db as unknown as Parameters<typeof pgOutboxQueue>[0])
  let c: Awaited<ReturnType<typeof commerce>>

  const handlersWith = (provider: EmailProvider) =>
    ticketNotificationHandlers({
      store,
      tickets: service,
      performances: () => lookup,
      provider,
      siteUrl: 'https://teatrturdus.ru',
      theatreEmail: 'theatre@example.org',
    })
  const orderStatus = async (id: string) =>
    (await db.execute<{ status: string }>(sql`select status from commerce_orders where id = ${id}`))
      .rows[0]!.status
  const outboxRow = async (dedupeKey: string) =>
    (
      await db.execute<{ status: string; attempts: number; last_error: string | null }>(
        sql`select status, attempts, last_error from commerce_outbox where dedupe_key = ${dedupeKey}`,
      )
    ).rows[0]!

  beforeAll(async () => {
    const kit = createRequire(path.resolve('node_modules/@payloadcms/db-postgres/package.json'))(
      'drizzle-kit/api',
    ) as {
      generateDrizzleJson: (imports: Record<string, unknown>) => Promise<unknown>
      generateMigration: (prev: unknown, cur: unknown) => Promise<string[]>
    }
    const statements = await kit.generateMigration(
      await kit.generateDrizzleJson({}),
      await kit.generateDrizzleJson({ ...accountsTables, ...commerceTables }),
    )
    await db.execute(sql.raw('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'))
    for (const statement of statements) await db.execute(sql.raw(statement))
    for (const [id, email] of [
      [ALICE, 'alice@example.com'],
      [BOB, 'bob@example.com'],
    ])
      await db.execute(
        sql`insert into accounts_customers (id, email, created_at) values (${id}, ${email}, now())`,
      )
    c = await commerce(
      pgCommerceStore(db as unknown as Parameters<typeof pgCommerceStore>[0]),
      secret,
      100,
    )
  }, 60_000)

  afterAll(async () => {
    await db.$client.end()
  })

  it('account queries return only the customer own tickets and orders', async () => {
    const a = await c.buy(ALICE, 'p-future', 2, { bonus: 30_000 })
    await c.buy(ALICE, 'p-past', 1)
    await c.buy(BOB, 'p-future', 1)
    await c.buy(null, 'p-future', 1)

    const alice = await service.accountTickets(ALICE, NOW)
    expect(alice.upcoming.map((t) => t.number).sort()).toEqual(
      a.tickets.map((t) => t.number).sort(),
    )
    expect(alice.past).toHaveLength(1)
    expect(alice.orders).toHaveLength(2)
    expect(alice.orders.find((o) => o.number === a.order.number)).toMatchObject({
      grossKopecks: 300_000,
      bonusKopecks: 30_000,
      cashKopecks: 270_000,
      items: [{ quantity: 2, lineGrossKopecks: 300_000 }],
    })
    const bob = await service.accountTickets(BOB, NOW)
    expect(bob.upcoming).toHaveLength(1)
    expect(bob.orders).toHaveLength(1)

    const number = a.tickets[0]!.number
    expect(await service.ticketForCustomer(BOB, number, NOW)).toBeNull()
    expect(await service.qrFor({ number, customerId: BOB })).toEqual({
      ok: false,
      reason: 'not_found',
    })
    const qr = await service.qrFor({ number, customerId: ALICE })
    expect(qr).toEqual({ ok: true, number, token: ticketToken(secret, a.tickets[0]!) })
    expect(qr.ok && hashTicketToken(qr.token)).toBe(a.tickets[0]!.tokenHash)
    expect(await service.verifyTicketToken(ticketToken(secret, a.tickets[0]!))).toMatchObject({
      ok: true,
      valid: true,
    })
  })

  it('refund state hides the QR; the refund notice reads amounts and ticket numbers', async () => {
    const { order, tickets } = await c.buy(ALICE, 'p-future', 1)
    const refundId = randomUUID()
    await db.execute(
      sql`update commerce_tickets set status = 'REFUNDED', refunded_at = now() where id = ${tickets[0]!.id}`,
    )
    await db.execute(sql`insert into commerce_refunds
      (id, order_id, status, cash_kopecks, bonus_kopecks, fee_kopecks, idempotency_key, reason, requested_by, completed_at, created_at, updated_at)
      values (${refundId}, ${order.id}, 'SUCCEEDED', 150000, 0, 0, ${`r-${refundId}`}, 'customer', 'customer', now(), now(), now())`)
    await db.execute(sql`insert into commerce_refund_tickets (refund_id, ticket_id, cash_kopecks, bonus_kopecks, fee_kopecks)
      values (${refundId}, ${tickets[0]!.id}, 150000, 0, 0)`)

    expect(await service.qrFor({ number: tickets[0]!.number, customerId: ALICE })).toEqual({
      ok: false,
      reason: 'invalid',
      state: 'refunded',
    })
    const notice = await store.refundForNotice(refundId)
    expect(notice).toMatchObject({
      status: 'SUCCEEDED',
      cashKopecks: 150_000,
      order: { number: order.number, email: order.email },
      ticketNumbers: [tickets[0]!.number],
    })
  })

  it('email outage: retried with backoff, order stays PAID; then delivered exactly once', async () => {
    const { order } = await c.buy(ALICE, 'p-future', 1)
    const key = `order.paid:${order.id}`
    const sent: EmailMessage[] = []
    let down = true
    const provider: EmailProvider = {
      send: async (m) => {
        if (down) throw new EmailSendError('ECONNECTION', false)
        sent.push(m)
      },
    }
    let clock = new Date()
    const p = createOutboxProcessor({
      queue,
      handlers: handlersWith(provider),
      log: createLogger({ write: () => undefined }),
      now: () => clock,
      random: () => 0,
    })
    await p.runOnce()
    expect(await outboxRow(key)).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_error: 'EmailSendError:ECONNECTION',
    })
    expect(await orderStatus(order.id)).toBe('PAID')

    down = false
    clock = new Date(clock.getTime() + OUTBOX_RULES.baseDelayMs)
    await p.runOnce()
    await p.runOnce()
    expect(await outboxRow(key)).toMatchObject({ status: 'done', attempts: 2, last_error: null })
    expect(sent.filter((m) => m.idempotencyKey === key)).toHaveLength(1)
    expect(await orderStatus(order.id)).toBe('PAID')
  })

  it('three workers in parallel deliver every pending letter exactly once (SKIP LOCKED)', async () => {
    const orders = await Promise.all(
      Array.from({ length: 12 }, (_, i) => c.buy(i % 2 ? ALICE : BOB, 'p-future', 1)),
    )
    const counts = new Map<string, number>()
    const provider: EmailProvider = {
      send: async (m) => {
        await new Promise((r) => setTimeout(r, 5))
        counts.set(m.idempotencyKey!, (counts.get(m.idempotencyKey!) ?? 0) + 1)
      },
    }
    const workers = Array.from({ length: 3 }, () =>
      createOutboxProcessor({
        queue,
        handlers: handlersWith(provider),
        log: createLogger({ write: () => undefined }),
        rules: { ...OUTBOX_RULES, batchSize: 3 },
      }),
    )
    await Promise.all(workers.map((w) => w.runOnce()))
    for (const { order } of orders) expect(counts.get(`order.paid:${order.id}`)).toBe(1)
    const pending = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from commerce_outbox where kind = 'order.paid' and status <> 'done'`,
    )
    expect(pending.rows[0]!.n).toBe(0)
  })

  it('permanent failure → dead letter; other outbox kinds are left alone', async () => {
    const { order } = await c.buy(BOB, 'p-future', 1)
    await db.execute(
      sql`update commerce_outbox set status = 'pending' where dedupe_key = ${`order.paid:${order.id}`}`,
    )
    await db.execute(sql`insert into commerce_outbox (id, kind, dedupe_key, aggregate_id, payload, status, attempts, next_attempt_at, created_at)
      values (${randomUUID()}, 'refund.auto', ${`refund.auto:${order.id}`}, ${order.id}, '{}'::jsonb, 'pending', 0, now(), now())`)
    const lines: string[] = []
    const p = createOutboxProcessor({
      queue,
      handlers: handlersWith({
        send: async () => {
          throw new EmailSendError('SMTP_550', true)
        },
      }),
      log: createLogger({ write: (l) => lines.push(l) }),
    })
    await p.runOnce()
    expect(await outboxRow(`order.paid:${order.id}`)).toMatchObject({
      status: 'dead',
      last_error: 'EmailSendError:SMTP_550',
    })
    expect(await outboxRow(`refund.auto:${order.id}`)).toMatchObject({
      status: 'pending',
      attempts: 0,
    })
    expect(lines.join('\n')).toContain('ALERT_OUTBOX_STUCK')
    expect(lines.join('\n')).not.toContain('example.com')
    expect(await orderStatus(order.id)).toBe('PAID')
  })

  it.skipIf(!smtpPort || !mailpitApi)(
    'sends the real tickets letter over SMTP (Mailpit)',
    async () => {
      await fetch(`${mailpitApi}/api/v1/messages`, { method: 'DELETE' })
      const { order } = await c.buy(ALICE, 'p-future', 2)
      const provider = createSmtpProvider({
        provider: 'smtp',
        host: '127.0.0.1',
        port: Number(smtpPort),
        secure: false,
        requireTls: false,
        user: null,
        password: null,
        from: 'Модный театр TURDUS <tickets@teatrturdus.ru>',
        replyTo: null,
      })
      const item = {
        id: randomUUID(),
        kind: 'order.paid',
        dedupeKey: `order.paid:${order.id}`,
        aggregateId: order.id,
        payload: { orderId: order.id },
        attempts: 1,
        createdAt: new Date(),
      }
      await handlersWith(provider)['order.paid']!(item)
      const list = (await (await fetch(`${mailpitApi}/api/v1/messages`)).json()) as {
        messages: { ID: string; Subject: string; To: { Address: string }[]; Attachments: number }[]
      }
      expect(list.messages).toHaveLength(1)
      expect(list.messages[0]!.Subject).toContain(order.number)
      expect(list.messages[0]!.To[0]!.Address).toBe(order.email)
      const message = (await (
        await fetch(`${mailpitApi}/api/v1/message/${list.messages[0]!.ID}`)
      ).json()) as {
        MessageID: string
        Inline: { ContentType: string }[]
        Text: string
      }
      expect(message.Inline.filter((a) => a.ContentType === 'image/png')).toHaveLength(2)
      expect(message.MessageID).toMatch(/@teatrturdus\.ru$/)
      expect(message.Text).toContain('/api/tickets/')
    },
  )
})
