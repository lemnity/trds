import type { SQL } from '@payloadcms/db-postgres/drizzle'
import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import { describe, expect, it } from 'vitest'

import { emailOutboxJobs } from '../../src/jobs/tasks/outbox-email'
import { createLogger } from '../../src/lib/log'
import {
  EmailSendError,
  OUTBOX_RULES,
  PermanentOutboxError,
  backoffMs,
  createOutboxProcessor,
  emailConfigFromEnv,
  needsReviewEmail,
  refundEmail,
  ticketsEmail,
  type EmailMessage,
  type OutboxItem,
  type OutboxQueue,
} from '../../src/modules/email'
import { pgOutboxQueue } from '../../src/modules/email/pgOutbox'
import { classifySmtpError, createSmtpProvider, messageIdFor } from '../../src/modules/email/smtp'
import type { OutboxRow } from '../../src/modules/inventory/store'
import { memoryTicketsStore } from '../../src/modules/tickets/memoryStore'
import { ticketNotificationHandlers } from '../../src/modules/tickets/notifications'
import { createTicketsService } from '../../src/modules/tickets/service'
import { ticketSecretFrom, ticketToken } from '../../src/modules/tickets/token'
import { ALICE, PAYLOAD_SECRET, lookup, memoryCommerce } from './tickets-fixture'

// T-047: почтовый адаптер, шаблоны и обработка outbox (retry/backoff/dead-letter, идемпотентность).
const T0 = new Date('2026-10-25T12:00:00Z')
const secret = ticketSecretFrom(PAYLOAD_SECRET)

const capture = () => {
  const lines: string[] = []
  const log = createLogger({ level: 'debug', write: (l) => lines.push(l) })
  return { log, lines, records: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) }
}

/**
 * Очередь в памяти с той же семантикой, что `pgOutboxQueue`: захват атомарен (как SKIP LOCKED —
 * строку берёт один обработчик), аренда, условное завершение по номеру попытки.
 */
const memoryQueue = (rows: OutboxRow[]) => {
  const queue: OutboxQueue = {
    async claim({ kinds, now, limit, leaseMs }) {
      const ready = rows
        .filter(
          (r) =>
            kinds.includes(r.kind) &&
            (r.status === 'pending' || r.status === 'processing') &&
            r.nextAttemptAt <= now,
        )
        .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
        .slice(0, limit)
      for (const r of ready) {
        r.status = 'processing'
        r.attempts += 1
        r.nextAttemptAt = new Date(now.getTime() + leaseMs)
      }
      await new Promise((resolve) => setImmediate(resolve))
      return ready.map((r): OutboxItem => ({
        id: r.id,
        kind: r.kind,
        dedupeKey: r.dedupeKey,
        aggregateId: r.aggregateId,
        payload: r.payload,
        attempts: r.attempts,
        createdAt: r.createdAt,
      }))
    },
    async complete(item, now) {
      return finish(item, { status: 'done', processedAt: now, lastError: null })
    },
    async retry(item, at, error) {
      return finish(item, { status: 'pending', nextAttemptAt: at, lastError: error })
    },
    async bury(item, now, error) {
      return finish(item, { status: 'dead', nextAttemptAt: now, lastError: error })
    },
  }
  const finish = (item: OutboxItem, set: Partial<OutboxRow>) => {
    const row = rows.find((r) => r.id === item.id)
    if (!row || row.status !== 'processing' || row.attempts !== item.attempts) return false
    Object.assign(row, set)
    return true
  }
  return queue
}

const row = (n: number, kind = 'order.paid', over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  kind,
  dedupeKey: `${kind}:${n}`,
  aggregateId: `agg-${n}`,
  payload: {},
  status: 'pending',
  attempts: 0,
  nextAttemptAt: T0,
  lastError: null,
  createdAt: T0,
  processedAt: null,
  ...over,
})

describe('backoff', () => {
  it('grows exponentially with equal jitter and a cap', () => {
    expect(backoffMs(1, () => 0)).toBe(15_000)
    expect(backoffMs(1, () => 1)).toBe(30_000)
    expect(backoffMs(2, () => 1)).toBe(60_000)
    expect(backoffMs(4, () => 0.5)).toBe(180_000)
    expect(backoffMs(30, () => 1)).toBe(OUTBOX_RULES.maxDelayMs)
    for (let a = 1; a <= 10; a++) {
      const d = backoffMs(a)
      const exp = Math.min(OUTBOX_RULES.maxDelayMs, OUTBOX_RULES.baseDelayMs * 2 ** (a - 1))
      expect(d).toBeGreaterThanOrEqual(exp / 2)
      expect(d).toBeLessThanOrEqual(exp)
    }
  })
})

describe('outbox processor', () => {
  it('delivers once and marks done; a second run sends nothing (idempotent per dedupe key)', async () => {
    const rows = [row(1), row(2), row(3, 'payment.duplicate')]
    const sent: string[] = []
    const { log } = capture()
    const p = createOutboxProcessor({
      queue: memoryQueue(rows),
      handlers: { 'order.paid': async (i) => void sent.push(i.dedupeKey) },
      log,
      now: () => T0,
    })
    expect(await p.runOnce()).toEqual({ sent: 2, retried: 0, dead: 0, lost: 0 })
    expect(await p.runOnce()).toEqual({ sent: 0, retried: 0, dead: 0, lost: 0 })
    expect(sent).toEqual(['order.paid:1', 'order.paid:2'])
    expect(rows.map((r) => r.status)).toEqual(['done', 'done', 'pending'])
    // Чужие виды событий (автовозврат, дубль платежа) не захватываются.
    expect(rows[2]!.attempts).toBe(0)
  })

  it('two workers in parallel send each event exactly once', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(i + 1))
    const sent = new Map<string, number>()
    const make = () =>
      createOutboxProcessor({
        queue: memoryQueue(rows),
        handlers: {
          'order.paid': async (i) => {
            await new Promise((r) => setImmediate(r))
            sent.set(i.id, (sent.get(i.id) ?? 0) + 1)
          },
        },
        log: capture().log,
        now: () => T0,
        rules: { ...OUTBOX_RULES, batchSize: 4 },
      })
    await Promise.all([make().runOnce(), make().runOnce(), make().runOnce()])
    expect(sent.size).toBe(30)
    expect([...sent.values()].every((n) => n === 1)).toBe(true)
  })

  it('temporary failure: retry with backoff, then success; payment data untouched', async () => {
    const rows = [row(1)]
    let fail = 2
    let clock = T0
    const { log, records } = capture()
    const p = createOutboxProcessor({
      queue: memoryQueue(rows),
      handlers: {
        'order.paid': async () => {
          if (fail-- > 0) throw new EmailSendError('SMTP_421', false)
        },
      },
      log,
      now: () => clock,
      random: () => 1,
    })
    expect(await p.runOnce()).toMatchObject({ retried: 1 })
    expect(rows[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'EmailSendError:SMTP_421',
    })
    expect(rows[0]!.nextAttemptAt).toEqual(new Date(T0.getTime() + 30_000))
    // До срока повтора событие не берётся.
    expect(await p.runOnce()).toEqual({ sent: 0, retried: 0, dead: 0, lost: 0 })
    clock = new Date(T0.getTime() + 30_000)
    expect(await p.runOnce()).toMatchObject({ retried: 1 })
    expect(rows[0]!.nextAttemptAt).toEqual(new Date(clock.getTime() + 60_000))
    clock = new Date(clock.getTime() + 60_000)
    expect(await p.runOnce()).toMatchObject({ sent: 1 })
    expect(rows[0]).toMatchObject({ status: 'done', attempts: 3, lastError: null })
    // В логах — только тип ошибки, без адресов.
    expect(records().filter((r) => r.event === 'outbox.retry_scheduled')).toHaveLength(2)
  })

  it('max attempts → dead letter + ALERT_OUTBOX_STUCK', async () => {
    const rows = [row(1)]
    let clock = T0
    const { log, records } = capture()
    const p = createOutboxProcessor({
      queue: memoryQueue(rows),
      handlers: {
        'order.paid': async () => {
          throw new Error('connect ECONNREFUSED buyer@example.com')
        },
      },
      log,
      now: () => clock,
      random: () => 0,
    })
    for (let i = 0; i < OUTBOX_RULES.maxAttempts; i++) {
      await p.runOnce()
      clock = new Date(rows[0]!.nextAttemptAt.getTime())
    }
    expect(rows[0]).toMatchObject({
      status: 'dead',
      attempts: OUTBOX_RULES.maxAttempts,
      processedAt: null,
    })
    const alert = records().find((r) => r.alert === 'ALERT_OUTBOX_STUCK')
    expect(alert).toMatchObject({
      kind: 'order.paid',
      deadLetter: true,
      attempts: 8,
      error: 'Error',
    })
    expect(JSON.stringify(records())).not.toContain('example.com')
    // Мёртвое событие больше не берётся.
    expect(await p.runOnce()).toEqual({ sent: 0, retried: 0, dead: 0, lost: 0 })
  })

  it('permanent errors go to dead letter at once', async () => {
    const rows = [row(1), row(2)]
    const { log } = capture()
    const p = createOutboxProcessor({
      queue: memoryQueue(rows),
      handlers: {
        'order.paid': async (i) => {
          if (i.dedupeKey.endsWith(':1')) throw new PermanentOutboxError('ORDER_NOT_FOUND')
          throw new EmailSendError('SMTP_550', true)
        },
      },
      log,
      now: () => T0,
    })
    expect(await p.runOnce()).toMatchObject({ dead: 2 })
    expect(rows.map((r) => [r.status, r.attempts, r.lastError])).toEqual([
      ['dead', 1, 'PermanentOutboxError:ORDER_NOT_FOUND'],
      ['dead', 1, 'EmailSendError:SMTP_550'],
    ])
  })

  it('crashed worker: the event comes back after the lease; a stale result is not written', async () => {
    const rows = [row(1)]
    let clock = T0
    const queue = memoryQueue(rows)
    const [claimed] = await queue.claim({ kinds: ['order.paid'], now: T0, limit: 1, leaseMs: 1000 })
    // Первый worker «упал»; после аренды событие берёт второй.
    clock = new Date(T0.getTime() + 1000)
    const sent: number[] = []
    const p = createOutboxProcessor({
      queue,
      handlers: { 'order.paid': async (i) => void sent.push(i.attempts) },
      log: capture().log,
      now: () => clock,
    })
    expect(await p.runOnce()).toMatchObject({ sent: 1 })
    expect(sent).toEqual([2])
    // Опоздавший первый worker не перезаписывает результат.
    expect(await queue.retry(claimed!, clock, 'Late')).toBe(false)
    expect(rows[0]).toMatchObject({ status: 'done', attempts: 2 })
  })

  it('a slow handler times out and is retried', async () => {
    const rows = [row(1)]
    const p = createOutboxProcessor({
      queue: memoryQueue(rows),
      handlers: { 'order.paid': () => new Promise(() => undefined) },
      log: capture().log,
      now: () => T0,
      rules: { ...OUTBOX_RULES, handlerTimeoutMs: 10 },
    })
    expect(await p.runOnce()).toMatchObject({ retried: 1 })
    expect(rows[0]!.lastError).toBe('HandlerTimeoutError')
  })
})

describe('order.paid email over the real order flow', () => {
  const setup = async () => {
    const c = await memoryCommerce(secret)
    const store = memoryTicketsStore(c.store)
    const tickets = createTicketsService({ store, secret, performances: () => lookup })
    const sent: EmailMessage[] = []
    let failures = 0
    const provider = {
      send: async (m: EmailMessage) => {
        if (failures > 0) {
          failures--
          throw new EmailSendError('ETIMEDOUT', false)
        }
        sent.push(m)
      },
    }
    const handlers = ticketNotificationHandlers({
      store,
      tickets,
      performances: () => lookup,
      provider,
      siteUrl: 'https://teatrturdus.ru',
      theatreEmail: 'theatre@example.org',
    })
    const outbox = () => c.store.dump().outbox
    const queue = memoryQueue(outbox())
    return { ...c, sent, handlers, failNext: (n: number) => (failures = n), queue }
  }

  it('email API unavailable: the letter is retried, payment status and tickets unchanged', async () => {
    const s = await setup()
    const { order, tickets } = await s.buy(ALICE, 'p-future', 2)
    // memoryQueue получает копии строк outbox из dump — работаем с ними как с таблицей.
    const rows = s.store.dump().outbox.filter((r) => r.kind === 'order.paid')
    let clock = T0
    const p = createOutboxProcessor({
      queue: memoryQueue(rows),
      handlers: s.handlers,
      log: capture().log,
      now: () => clock,
      random: () => 0,
    })
    s.failNext(1)
    expect(await p.runOnce()).toMatchObject({ retried: 1, sent: 0 })
    const after = s.store.dump()
    expect(after.orders.find((o) => o.id === order.id)!.status).toBe('PAID')
    expect(after.tickets.filter((t) => t.orderId === order.id).map((t) => t.status)).toEqual([
      'ISSUED',
      'ISSUED',
    ])

    clock = rows[0]!.nextAttemptAt
    expect(await p.runOnce()).toMatchObject({ sent: 1 })
    expect(s.sent).toHaveLength(1)
    const mail = s.sent[0]!
    expect(mail.to).toBe(order.email)
    expect(mail.idempotencyKey).toBe(`order.paid:${order.id}`)
    expect(mail.subject).toContain(order.number)
    expect(mail.subject).not.toContain('@')
    expect(mail.attachments).toHaveLength(2)
    expect(mail.attachments!.every((a) => a.contentType === 'image/png' && a.cid)).toBe(true)
    for (const t of tickets) {
      expect(mail.text).toContain(t.number)
      // Токен входа в письме только внутри картинки QR, не текстом и не в ссылке.
      expect(mail.text).not.toContain(ticketToken(secret, t))
      expect(mail.html).not.toContain(ticketToken(secret, t))
    }
    expect(mail.html).toContain('cid:qr-1@turdus')
    expect(mail.text).toContain('https://teatrturdus.ru/api/tickets/')
    expect(mail.text).toContain('Бар «Тест», Екатеринбург, ул. Тестовая, 1')
  })

  it('needs-review notice goes to the theatre without buyer data', async () => {
    const s = await setup()
    const { order } = await s.buy(ALICE, 'p-future', 1)
    await s.handlers['order.needs_review']!({
      id: 'x',
      kind: 'order.needs_review',
      dedupeKey: `order.needs_review:${order.id}`,
      aggregateId: order.id,
      payload: { orderId: order.id, orderNumber: order.number },
      attempts: 1,
      createdAt: T0,
    })
    expect(s.sent[0]!.to).toBe('theatre@example.org')
    expect(s.sent[0]!.text).toContain(order.number)
    expect(`${s.sent[0]!.text}${s.sent[0]!.html}`).not.toContain(order.email)
  })

  it('unknown order or bad payload is a permanent error', async () => {
    const s = await setup()
    const item = (payload: Record<string, unknown>): OutboxItem => ({
      id: 'x',
      kind: 'order.paid',
      dedupeKey: 'order.paid:x',
      aggregateId: 'not-a-uuid',
      payload,
      attempts: 1,
      createdAt: T0,
    })
    await expect(s.handlers['order.paid']!(item({}))).rejects.toBeInstanceOf(PermanentOutboxError)
    await expect(
      s.handlers['order.paid']!(item({ orderId: '99999999-9999-4999-8999-999999999999' })),
    ).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' })
  })

  it('without a theatre address the needs-review kind is not claimed at all', async () => {
    const c = await memoryCommerce(secret)
    const store = memoryTicketsStore(c.store)
    const handlers = ticketNotificationHandlers({
      store,
      tickets: createTicketsService({ store, secret, performances: () => lookup }),
      performances: () => lookup,
      provider: { send: async () => undefined },
      siteUrl: 'https://teatrturdus.ru',
      theatreEmail: null,
    })
    expect(Object.keys(handlers).sort()).toEqual(['order.paid', 'refund.succeeded'])
  })
})

describe('email templates', () => {
  it('escapes HTML in every interpolated value', () => {
    const mail = ticketsEmail({
      orderNumber: 'TRD-<b>',
      tickets: [
        {
          number: 'TRD-X-01',
          showTitle: '<script>alert(1)</script>',
          when: '20 ноября',
          venue: { title: 'A & B', address: '"ул."' },
          category: 'Входной',
          seat: null,
          qrPng: Buffer.from('png'),
          qrLink: 'javascript:alert(1)',
        },
      ],
      amounts: { grossKopecks: 150_000, bonusKopecks: 30_000, feeKopecks: 0, cashKopecks: 120_000 },
      accountUrl: 'https://teatrturdus.ru/account',
    })
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;script&gt;')
    expect(mail.html).toContain('A &amp; B')
    expect(mail.html).not.toContain('javascript:')
    // Intl ставит неразрывные пробелы — сравниваем с обычными.
    const text = mail.text.replace(/[\u00a0\u202f]/g, ' ')
    expect(text).toContain('Оплачено бонусами: −300 ₽')
    expect(text).toContain('Оплачено: 1 200 ₽')
  })

  it('refund notice distinguishes processing from completed', () => {
    const base = {
      orderNumber: 'TRD-ABCDEFGH',
      ticketNumbers: ['TRD-ABCDEFGH-01'],
      cashKopecks: 150_000,
      bonusKopecks: 0,
      accountUrl: 'https://teatrturdus.ru/account',
    }
    expect(refundEmail({ ...base, completed: false }).subject).toContain('обрабатывается')
    expect(refundEmail({ ...base, completed: false }).text).not.toContain('Деньги поступят')
    expect(refundEmail({ ...base, completed: true }).subject).toContain('выполнен')
  })

  it('needs-review email explains the reason', () => {
    const mail = needsReviewEmail({
      orderNumber: 'TRD-ABCDEFGH',
      reason: 'LATE_PAYMENT_NO_STOCK',
      adminUrl: 'https://teatrturdus.ru/admin',
    })
    expect(mail.text).toContain('свободных мест уже нет')
    expect(mail.html).toContain('LATE_PAYMENT_NO_STOCK')
  })
})

describe('SMTP adapter and configuration', () => {
  it('classifies SMTP errors: 5xx permanent, 4xx/network temporary, auth temporary', () => {
    expect(classifySmtpError({ responseCode: 550, code: 'EENVELOPE' })).toMatchObject({
      code: 'SMTP_550',
      permanent: true,
    })
    expect(classifySmtpError({ responseCode: 421 })).toMatchObject({
      code: 'SMTP_421',
      permanent: false,
    })
    expect(classifySmtpError({ responseCode: 535, code: 'EAUTH' })).toMatchObject({
      permanent: false,
    })
    expect(classifySmtpError({ code: 'ETIMEDOUT' })).toMatchObject({
      code: 'ETIMEDOUT',
      permanent: false,
    })
    expect(classifySmtpError(new Error('boom user@example.com'))).toMatchObject({
      code: 'SMTP_UNKNOWN',
      permanent: false,
    })
  })

  it('passes a stable Message-ID and inline attachments to the transport', async () => {
    const calls: Record<string, unknown>[] = []
    const provider = createSmtpProvider(
      {
        provider: 'smtp',
        host: 'smtp.example.org',
        port: 587,
        secure: false,
        requireTls: true,
        user: 'u',
        password: 'p',
        from: 'TURDUS <tickets@teatrturdus.ru>',
        replyTo: null,
      },
      { sendMail: async (o) => void calls.push(o) },
    )
    const message: EmailMessage = {
      to: 'a@example.com',
      subject: 's',
      text: 't',
      attachments: [
        {
          filename: 'q.png',
          content: Buffer.from('x'),
          contentType: 'image/png',
          cid: 'qr-1@turdus',
        },
      ],
      idempotencyKey: 'order.paid:1',
    }
    await provider.send(message)
    await provider.send(message)
    expect(calls[0]!.messageId).toBe(messageIdFor('order.paid:1', 'tickets@teatrturdus.ru'))
    expect(calls[0]!.messageId).toBe(calls[1]!.messageId)
    expect(String(calls[0]!.messageId)).toMatch(/^<[0-9a-f]{32}@teatrturdus\.ru>$/)
    expect(calls[0]!.attachments).toEqual([
      expect.objectContaining({ cid: 'qr-1@turdus', contentDisposition: 'inline' }),
    ])
  })

  it('parses env: smtp requires host and from; dev only in development; TLS required off-localhost', () => {
    expect(emailConfigFromEnv({}, { dev: true })).toEqual({ provider: 'dev' })
    expect(emailConfigFromEnv({}, { dev: false })).toEqual({
      provider: 'none',
      missing: ['EMAIL_PROVIDER'],
    })
    expect(emailConfigFromEnv({ EMAIL_PROVIDER: 'smtp' }, { dev: false })).toEqual({
      provider: 'none',
      missing: ['SMTP_HOST', 'EMAIL_FROM'],
    })
    expect(
      emailConfigFromEnv(
        {
          EMAIL_PROVIDER: 'smtp',
          SMTP_HOST: 'smtp.notisend.ru',
          EMAIL_FROM: 'a@b.ru',
          SMTP_USER: 'u',
        },
        { dev: false },
      ),
    ).toEqual({ provider: 'none', missing: ['SMTP_PASSWORD'] })
    expect(
      emailConfigFromEnv(
        {
          EMAIL_PROVIDER: 'smtp',
          SMTP_HOST: 'smtp.notisend.ru',
          SMTP_PORT: '465',
          EMAIL_FROM: 'a@b.ru',
        },
        { dev: false },
      ),
    ).toMatchObject({ provider: 'smtp', port: 465, secure: true, requireTls: false })
    expect(
      emailConfigFromEnv(
        { EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.unisender.ru', EMAIL_FROM: 'a@b.ru' },
        { dev: false },
      ),
    ).toMatchObject({ port: 587, secure: false, requireTls: true })
    expect(
      emailConfigFromEnv(
        { EMAIL_PROVIDER: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025', EMAIL_FROM: 'a@b.ru' },
        { dev: true },
      ),
    ).toMatchObject({ requireTls: false })
  })
})

describe('outbox.email worker job', () => {
  it('is not registered without SMTP and says why (letters wait in the queue)', () => {
    const { log, records } = capture()
    expect(emailOutboxJobs({ db: {}, log, env: { NODE_ENV: 'production' } })).toEqual([])
    expect(records()[0]).toMatchObject({
      event: 'outbox.email_disabled',
      missing: ['EMAIL_PROVIDER'],
    })
  })

  it('is registered with SMTP configured', () => {
    const { log } = capture()
    const jobs = emailOutboxJobs({
      db: {},
      log,
      env: {
        EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        EMAIL_FROM: 'tickets@teatrturdus.ru',
        PAYLOAD_SECRET,
      },
    })
    expect(jobs.map((j) => j.name)).toEqual(['outbox.email'])
  })
})

describe('pgOutboxQueue SQL', () => {
  const dialect = new PgDialect()
  const fake = () => {
    const queries: { sql: string; params: unknown[] }[] = []
    return {
      queries,
      db: {
        execute: async (q: SQL) => {
          queries.push(dialect.sqlToQuery(q))
          return { rows: [], rowCount: 1 }
        },
      },
    }
  }

  it('claims only its kinds with SKIP LOCKED and a lease; finishes conditionally on the attempt', async () => {
    const { db, queries } = fake()
    const q = pgOutboxQueue(db)
    await q.claim({
      kinds: ['order.paid', 'refund.succeeded'],
      now: T0,
      limit: 20,
      leaseMs: 300_000,
    })
    expect(queries[0]!.sql).toMatch(/for update skip locked/)
    expect(queries[0]!.sql).toMatch(/attempts = o\.attempts \+ 1/)
    expect(queries[0]!.params).toEqual(
      expect.arrayContaining(['order.paid', 'refund.succeeded', 20, '2026-10-25T12:05:00.000Z']),
    )
    const item: OutboxItem = {
      id: 'i',
      kind: 'order.paid',
      dedupeKey: 'k',
      aggregateId: 'a',
      payload: {},
      attempts: 3,
      createdAt: T0,
    }
    expect(await q.complete(item, T0)).toBe(true)
    expect(queries[1]!.sql).toMatch(/status = 'processing' and attempts = \$\d+/)
    expect(queries[1]!.params).toEqual(expect.arrayContaining(['i', 3]))
    // Ничего, кроме commerce_outbox, очередь не обновляет (оплата и заказ не трогаются).
    for (const query of queries) expect(query.sql).not.toMatch(/commerce_orders|commerce_tickets/)
  })
})
