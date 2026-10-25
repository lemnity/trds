import { describe, expect, it } from 'vitest'

import { leadOutboxJobs } from '../../src/jobs/tasks/outbox-leads'
import { createLogger } from '../../src/lib/log'
import {
  PermanentOutboxError,
  createOutboxProcessor,
  leadCreatedEmail,
  type EmailMessage,
  type OutboxItem,
  type OutboxQueue,
} from '../../src/modules/email'
import {
  leadNotificationHandlers,
  type LeadNotice,
} from '../../src/modules/lead-requests/notifications'
import {
  LEAD_CREATED_KIND,
  createLeadRequestService,
  memoryLeadStore,
} from '../../src/modules/lead-requests/service'

// T-034/T-065: письмо театру о новой заявке — через outbox `lead.created`, без контактов
// заявителя в письме, очереди и логах; одно событие и стабильный Message-ID на заявку.
const capture = () => {
  const lines: string[] = []
  return { log: createLogger({ level: 'debug', write: (l) => lines.push(l) }), lines }
}

const form = {
  name: 'Тати Сенютина',
  email: 'tati@stolnik.ru',
  phone: '+79826575426',
  date: '2026-12-25',
  guests: '40',
  format: 'birthday',
  budget: '200 000',
  comment: 'Новогодний вечер',
  consent: true,
}

/** Очередь в памяти поверх событий хранилища заявок: та же семантика попыток, что в pgOutbox. */
const queueOver = (
  rows: {
    id: string
    kind: string
    dedupeKey: string
    aggregateId: string
    payload: Record<string, unknown>
    status: string
    attempts: number
    createdAt: Date
  }[],
): OutboxQueue => ({
  async claim({ kinds, limit }) {
    const ready = rows
      .filter((r) => kinds.includes(r.kind) && r.status === 'pending')
      .slice(0, limit)
    return ready.map((r): OutboxItem => {
      r.status = 'processing'
      r.attempts += 1
      return {
        id: r.id,
        kind: r.kind,
        dedupeKey: r.dedupeKey,
        aggregateId: r.aggregateId,
        payload: r.payload,
        attempts: r.attempts,
        createdAt: r.createdAt,
      }
    })
  },
  async complete(item) {
    const r = rows.find((x) => x.id === item.id && x.attempts === item.attempts)
    if (!r) return false
    r.status = 'done'
    return true
  },
  async retry(item) {
    const r = rows.find((x) => x.id === item.id)
    if (r) r.status = 'pending'
    return !!r
  },
  async bury(item) {
    const r = rows.find((x) => x.id === item.id)
    if (r) r.status = 'dead'
    return !!r
  },
})

const setup = async () => {
  const store = memoryLeadStore()
  const leads = createLeadRequestService({ store, now: () => new Date('2026-10-25T10:00:00Z') })
  await leads.submit({ form, idempotencyKey: 'lead-key-0123456789abcdef', source: 'corporate' })
  const lead = store.dump().leads[0]!
  const lookup = async (id: string): Promise<LeadNotice | null> => {
    const l = (await store.findLead(id)) ?? null
    return (
      l && {
        id: l.id,
        format: l.format,
        eventDate: l.eventDate,
        guests: l.guests,
        duplicate: l.duplicateOf !== null,
        createdAt: l.createdAt,
      }
    )
  }
  const sent: EmailMessage[] = []
  const handlers = leadNotificationHandlers({
    lookup,
    provider: { send: async (m) => void sent.push(m) },
    siteUrl: 'https://teatrturdus.ru',
    theatreEmail: 'office@teatr.example',
  })
  return { store, lead, lookup, sent, handlers }
}

describe('lead.created outbox handler', () => {
  it('sends one email to the theatre with a stable key and no contact data', async () => {
    const { store, sent, handlers } = await setup()
    const rows = store.dump().outbox.map((o) => ({ ...o }))
    const { log, lines } = capture()
    const processor = createOutboxProcessor({ queue: queueOver(rows), handlers, log })
    expect(processor.kinds).toEqual([LEAD_CREATED_KIND])
    expect(await processor.runOnce()).toMatchObject({ sent: 1, dead: 0 })
    // Повторный проход: событие уже done — второго письма нет.
    expect(await processor.runOnce()).toMatchObject({ sent: 0 })
    expect(sent).toHaveLength(1)
    const [mail] = sent
    expect(mail).toMatchObject({
      to: 'office@teatr.example',
      subject: 'Новая заявка: День рождения',
      idempotencyKey: rows[0]!.dedupeKey,
    })
    expect(mail!.text).toContain('25 декабря 2026')
    expect(mail!.text).toContain('Гостей: 40')
    expect(mail!.text).toContain('https://teatrturdus.ru/admin/leads')
    const everything = JSON.stringify({ mail, lines, rows })
    for (const pii of ['tati@', '79826575426', 'Сенютина', 'Новогодний', '200 000'])
      expect(everything).not.toContain(pii)
  })

  it('a deleted lead is a permanent failure (dead-letter, no retries)', async () => {
    const { handlers } = await setup()
    const handler = handlers[LEAD_CREATED_KIND]!
    await expect(
      handler({
        id: 'x',
        kind: LEAD_CREATED_KIND,
        dedupeKey: 'lead.created:gone',
        aggregateId: '00000000-0000-4000-8000-000000000000',
        payload: { leadId: '00000000-0000-4000-8000-000000000000' },
        attempts: 1,
        createdAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(PermanentOutboxError)
  })

  it('without THEATRE_NOTIFY_EMAIL there is no handler — events wait in the queue', async () => {
    const { lookup } = await setup()
    expect(
      leadNotificationHandlers({
        lookup,
        provider: { send: async () => {} },
        siteUrl: 'https://x',
        theatreEmail: null,
      }),
    ).toEqual({})
  })

  it('escapes values in the HTML version', () => {
    const mail = leadCreatedEmail({
      formatLabel: '<b>x</b>',
      eventDate: null,
      guests: null,
      duplicate: true,
      boardUrl: 'javascript:alert(1)',
    })
    expect(mail.html).not.toContain('<b>x</b>')
    expect(mail.html).toContain('href="#"')
    expect(mail.text).toContain('Похоже на повтор')
  })
})

describe('outbox.leads worker job', () => {
  const smtp = {
    EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'localhost',
    EMAIL_FROM: 'noreply@example.com',
  }

  it('is disabled without SMTP or without the theatre address', () => {
    const { log, lines } = capture()
    expect(
      leadOutboxJobs({ db: {}, log, env: { THEATRE_NOTIFY_EMAIL: 'office@teatr.example' } }),
    ).toEqual([])
    expect(leadOutboxJobs({ db: {}, log, env: smtp })).toEqual([])
    const warnings = lines.map(
      (l) => JSON.parse(l) as { msg?: string; event?: string; missing?: string[] },
    )
    expect(JSON.stringify(warnings)).toContain('THEATRE_NOTIFY_EMAIL')
    // Адрес театра в лог не пишется.
    expect(lines.join('\n')).not.toContain('office@teatr.example')
  })

  it('registers one job when both are configured', () => {
    const { log, lines } = capture()
    const jobs = leadOutboxJobs({
      db: {},
      log,
      env: { ...smtp, THEATRE_NOTIFY_EMAIL: 'office@teatr.example' },
    })
    expect(jobs.map((j) => j.name)).toEqual(['outbox.leads'])
    expect(lines.join('\n')).not.toContain('office@teatr.example')
  })
})
