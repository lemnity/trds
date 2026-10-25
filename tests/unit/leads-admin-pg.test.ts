import { createRequire } from 'node:module'
import path from 'node:path'

import { sql } from '@payloadcms/db-postgres/drizzle'
import { drizzle } from '@payloadcms/db-postgres/drizzle/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { accountsTables } from '../../src/db/schema/accounts'
import { commerceTables } from '../../src/db/schema/commerce'
import { leadsTables } from '../../src/db/schema/leads'
import { walletTables } from '../../src/db/schema/wallet'
import { createLogger } from '../../src/lib/log'
import { createOutboxProcessor, type EmailMessage } from '../../src/modules/email'
import { pgOutboxQueue } from '../../src/modules/email/pgOutbox'
import { createLeadBoardService } from '../../src/modules/lead-requests/board'
import { leadNotificationHandlers } from '../../src/modules/lead-requests/notifications'
import { pgLeadNoticeLookup, pgLeadStore } from '../../src/modules/lead-requests/pgStore'
import { createLeadRequestService } from '../../src/modules/lead-requests/service'
import { listCertificates } from '../../src/modules/wallet/admin'
import { pgWalletStore } from '../../src/modules/wallet/pgStore'
import { createWalletService } from '../../src/modules/wallet/service'

/**
 * Канбан, уведомление о заявке и список сертификатов на настоящем PostgreSQL (T-065, T-034,
 * T-066). Только с LEADS_PG_URL — ОДНОРАЗОВАЯ база: схема public пересоздаётся. Например:
 *   docker run --rm -d --name trds-leads-test -p 127.0.0.1:55491:5432 \
 *     -e POSTGRES_PASSWORD=x postgres:16.15-alpine
 *   LEADS_PG_URL=postgres://postgres:x@127.0.0.1:55491/postgres pnpm vitest run leads-admin-pg
 */
const url = process.env.LEADS_PG_URL
const NOW = new Date('2026-10-26T09:00:00Z')

const form = {
  name: 'Тати Сенютина',
  email: 'tati@stolnik.ru',
  phone: '',
  date: '2026-12-25',
  guests: '40',
  format: 'corporate',
  budget: '',
  comment: 'Новогодний вечер',
  consent: true,
}

describe.skipIf(!url)('lead board and certificates on PostgreSQL', () => {
  const db = drizzle({ connection: { connectionString: url!, max: 20 } })
  const store = pgLeadStore(db as unknown as Parameters<typeof pgLeadStore>[0])
  const leads = createLeadRequestService({ store, now: () => NOW })
  const board = createLeadBoardService({ store, now: () => NOW })
  let leadId = ''

  beforeAll(async () => {
    const kit = createRequire(path.resolve('node_modules/@payloadcms/db-postgres/package.json'))(
      'drizzle-kit/api',
    ) as {
      generateDrizzleJson: (imports: Record<string, unknown>) => Promise<unknown>
      generateMigration: (prev: unknown, cur: unknown) => Promise<string[]>
    }
    const statements = await kit.generateMigration(
      await kit.generateDrizzleJson({}),
      await kit.generateDrizzleJson({
        ...accountsTables,
        ...walletTables,
        ...leadsTables,
        ...commerceTables,
      }),
    )
    await db.execute(sql.raw('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'))
    for (const statement of statements) await db.execute(sql.raw(statement))
  }, 60_000)

  afterAll(async () => {
    await db.$client.end()
  })

  it('a lead and its lead.created outbox event are written together, once', async () => {
    const submit = () =>
      leads.submit({ form, idempotencyKey: 'pg-lead-key-0123456789', source: 'corporate' })
    const results = await Promise.all([submit(), submit(), submit()])
    expect(results.filter((r) => r.ok && !r.replay)).toHaveLength(1)
    const rows = await db.execute<{ id: string; status: string; assignee: string | null }>(
      sql`select id, status, assignee from leads_requests`,
    )
    expect(rows.rows).toHaveLength(1)
    leadId = rows.rows[0]!.id
    const outbox = await db.execute<{
      kind: string
      dedupe_key: string
      payload: unknown
      status: string
    }>(sql`select kind, dedupe_key, payload, status from commerce_outbox`)
    expect(outbox.rows).toEqual([
      {
        kind: 'lead.created',
        dedupe_key: `lead.created:${leadId}`,
        payload: { leadId },
        status: 'pending',
      },
    ])
  })

  it('the archive status passes the CHECK constraint; unknown statuses do not', async () => {
    await expect(
      db.execute(sql`update leads_requests set status = 'paid' where id = ${leadId}`),
    ).rejects.toThrow()
  })

  it('parallel moves from the same status: one wins, one history row, one audit row', async () => {
    const targets = ['in_progress', 'done', 'archived', 'in_progress', 'done', 'archived'] as const
    const results = await Promise.all(
      targets.map((to, i) =>
        board.move({ id: leadId, from: 'new', to }, { staffId: String(i + 1) }),
      ),
    )
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok && r.error === 'conflict')).toHaveLength(targets.length - 1)
    const history = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from leads_status_history where lead_id = ${leadId} and from_status = 'new'`,
    )
    expect(history.rows[0]!.n).toBe(1)
    const audit = await db.execute<{ action: string; entity: string; actor: string }>(
      sql`select action, entity, actor from commerce_audit_log where entity_id = ${leadId}`,
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]).toMatchObject({ action: 'cms.lead.move', entity: 'leads_requests' })
    const detail = await board.detail(leadId)
    expect(detail?.history.map((h) => h.toStatus)).toEqual([
      'new',
      (results.find((r) => r.ok) as { status: string }).status,
    ])
  })

  it('assignment is conditional and audited', async () => {
    const staff = new Set(['7', '8'])
    expect(
      await board.assign({ id: leadId, expected: null, assignee: '7' }, { staffId: '1' }, staff),
    ).toEqual({
      ok: true,
      assignee: '7',
    })
    expect(
      await board.assign({ id: leadId, expected: null, assignee: '8' }, { staffId: '1' }, staff),
    ).toEqual({
      ok: false,
      error: 'conflict',
      assignee: '7',
    })
    const cards = await board.board()
    expect(cards).toEqual([
      expect.objectContaining({ id: leadId, assignee: '7', duplicate: false }),
    ])
    expect(JSON.stringify(cards)).not.toContain('tati@')
  })

  it('the worker sends the theatre email from the outbox once (SKIP LOCKED queue)', async () => {
    const sent: EmailMessage[] = []
    const lines: string[] = []
    const processor = createOutboxProcessor({
      queue: pgOutboxQueue(db as never),
      handlers: leadNotificationHandlers({
        lookup: pgLeadNoticeLookup(db as unknown as Parameters<typeof pgLeadNoticeLookup>[0]),
        provider: { send: async (m) => void sent.push(m) },
        siteUrl: 'https://teatrturdus.ru',
        theatreEmail: 'office@teatr.example',
      }),
      log: createLogger({ level: 'debug', write: (l) => lines.push(l) }),
      now: () => new Date(NOW.getTime() + 60_000),
    })
    const [a, b] = await Promise.all([processor.runOnce(), processor.runOnce()])
    expect(a.sent + b.sent).toBe(1)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      to: 'office@teatr.example',
      idempotencyKey: `lead.created:${leadId}`,
    })
    expect(JSON.stringify({ sent, lines })).not.toMatch(/tati@|Сенютина|Новогодний/)
    const status = await db.execute<{ status: string }>(sql`select status from commerce_outbox`)
    expect(status.rows).toEqual([{ status: 'done' }])
  })

  it('lists certificates for the admin: statuses incl. expired, no code hash, filters', async () => {
    const wallet = createWalletService({
      store: pgWalletStore(db as unknown as Parameters<typeof pgWalletStore>[0]),
      secret: 'pg-test-certificate-secret-0123456789',
    })
    const issuedAt = new Date('2026-01-10T09:00:00Z')
    const serialOf = (c: { serial: string }) => Number(c.serial.replace(/\D/g, ''))
    const shortLived = await wallet.issueCertificates(
      {
        amountKopecks: 300_000,
        count: 1,
        validUntil: new Date('2026-02-01T00:00:00Z'),
        issuedBy: 'admin-users:1',
      },
      issuedAt,
    )
    const batch = await wallet.issueCertificates(
      {
        amountKopecks: 500_000,
        count: 2,
        validUntil: null,
        comment: 'Партнёр',
        issuedBy: 'admin-users:1',
      },
      issuedAt,
    )
    expect(await wallet.annulCertificate(serialOf(batch[0]!))).toBe(true)
    // Аннулированный повторно — нет.
    expect(await wallet.annulCertificate(serialOf(batch[0]!))).toBe(false)

    const all = await listCertificates(db as unknown as Parameters<typeof listCertificates>[0], {
      now: NOW,
    })
    expect(all.total).toBe(3)
    expect(all.items.map((i) => [i.serial, i.status])).toEqual([
      [serialOf(batch[1]!), 'issued'],
      [serialOf(batch[0]!), 'annulled'],
      [serialOf(shortLived[0]!), 'expired'],
    ])
    expect(Object.keys(all.items[0]!)).not.toContain('codeHash')
    expect(JSON.stringify(all)).not.toContain(batch[1]!.code)
    expect(all.items[0]!.last4).toBe(batch[1]!.code.replace(/\W/g, '').slice(-4))

    const expired = await listCertificates(db as never, { status: 'expired', now: NOW })
    expect(expired.items.map((i) => i.serial)).toEqual([serialOf(shortLived[0]!)])
    const issued = await listCertificates(db as never, { status: 'issued', now: NOW })
    expect(issued.items.map((i) => i.serial)).toEqual([serialOf(batch[1]!)])
  })
})
