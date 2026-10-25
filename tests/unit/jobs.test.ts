import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import type { SQL } from '@payloadcms/db-postgres/drizzle'
import { describe, expect, it } from 'vitest'

import {
  ACCOUNTS_RETENTION,
  CLEANUP_BATCH,
  accountsCleanupJob,
} from '../../src/jobs/tasks/accounts-cleanup'
import { outboxMonitorJob } from '../../src/jobs/tasks/outbox-monitor'
import type { SqlExecutor } from '../../src/jobs/tasks/types'
import { walletExpireJob } from '../../src/jobs/tasks/wallet-expire'
import { runWorker } from '../../src/jobs/worker'
import { createLogger } from '../../src/lib/log'
import { createWalletService, memoryWalletStore } from '../../src/modules/wallet/service'

// Регистрация и изоляция фоновых задач worker (T-015, architecture.md §12).
const NOW = new Date('2026-10-25T12:00:00Z')
const dialect = new PgDialect()

const capture = () => {
  const lines: string[] = []
  const log = createLogger({ level: 'debug', write: (l) => lines.push(l) })
  return { log, records: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) }
}

/** Фейковое соединение: записывает SQL и параметры, отвечает по очереди заготовками. */
const fakeDb = (responses: { rows?: Record<string, unknown>[]; rowCount?: number }[]) => {
  const queries: { sql: string; params: unknown[] }[] = []
  const db: SqlExecutor = {
    execute: async (query: SQL) => {
      const { sql, params } = dialect.sqlToQuery(query)
      queries.push({ sql, params })
      const next = responses.shift() ?? { rows: [], rowCount: 0 }
      return { rows: next.rows ?? [], rowCount: next.rowCount ?? null }
    },
  }
  return { db, queries }
}

describe('wallet.expire job', () => {
  it('runs expireDue of the real wallet service and is idempotent', async () => {
    const wallet = createWalletService({ store: memoryWalletStore(), secret: 'test' })
    await wallet.accrue('alice', 1_000_000, 'o1', new Date('2025-09-01T00:00:00Z'))
    const { log, records } = capture()
    const job = walletExpireJob({ wallet: async () => wallet, log, now: () => NOW })

    await job.run()
    await job.run()

    expect(job.name).toBe('wallet.expire')
    expect(job.everyMs).toBe(60 * 60 * 1000)
    // Второй запуск ничего не сжигает и не пишет в лог.
    expect(records()).toEqual([
      expect.objectContaining({ event: 'wallet.expired', lots: 1, kopecks: 30_000 }),
    ])
    expect(await wallet.balance('alice', NOW)).toBe(0)
  })
})

describe('accounts.cleanup job', () => {
  it('deletes long-expired codes, ended sessions and old rate-limit windows with SKIP LOCKED', async () => {
    const { db, queries } = fakeDb([
      { rowCount: CLEANUP_BATCH },
      { rowCount: 7 },
      { rowCount: 2 },
      { rowCount: 4 },
    ])
    const { log, records } = capture()
    await accountsCleanupJob({ db: async () => db, log, now: () => NOW }).run()

    expect(queries).toHaveLength(4)
    expect(queries[0]!.sql).toContain('delete from "accounts_auth_codes"')
    expect(queries[2]!.sql).toContain('delete from "accounts_sessions"')
    expect(queries[3]!.sql).toContain('delete from "ops_rate_limits"')
    expect(queries[3]!.params).toContain(NOW.toISOString())
    for (const q of queries) expect(q.sql).toContain('for update skip locked')
    const codesCutoff = new Date(NOW.getTime() - ACCOUNTS_RETENTION.authCodesAfterExpiryMs)
    expect(queries[0]!.params).toContain(codesCutoff.toISOString())
    expect(records()).toEqual([
      expect.objectContaining({
        event: 'accounts.cleaned',
        codesDeleted: CLEANUP_BATCH + 7,
        sessionsDeleted: 2,
        rateLimitWindowsDeleted: 4,
      }),
    ])
  })

  it('stays silent when there is nothing to delete', async () => {
    const { db } = fakeDb([])
    const { log, records } = capture()
    await accountsCleanupJob({ db: async () => db, log, now: () => NOW }).run()
    expect(records()).toEqual([])
  })
})

describe('outbox.monitor job', () => {
  it('does nothing until the outbox table exists', async () => {
    const { db, queries } = fakeDb([{ rows: [{ n: 0 }] }])
    const { log, records } = capture()
    await outboxMonitorJob({ db: async () => db, log, now: () => NOW }).run()
    expect(queries).toHaveLength(1)
    expect(records()).toEqual([])
  })

  it('raises ALERT_OUTBOX_STUCK for unprocessed events older than the threshold', async () => {
    const { db, queries } = fakeDb([{ rows: [{ n: 2 }] }, { rows: [{ stuck: 3, oldest: NOW }] }])
    const { log, records } = capture()
    await outboxMonitorJob({ db: async () => db, log, now: () => NOW, stuckAfterMs: 60_000 }).run()
    expect(queries[1]!.sql).toContain('from "commerce_outbox"')
    expect(queries[1]!.params).toContain(new Date(NOW.getTime() - 60_000).toISOString())
    expect(records()).toEqual([
      expect.objectContaining({ event: 'alert', alert: 'ALERT_OUTBOX_STUCK', stuck: 3 }),
    ])
  })

  it('warns once, not every tick, when the table has an unexpected shape', async () => {
    const { db } = fakeDb([{ rows: [{ n: 1 }] }, { rows: [{ n: 1 }] }])
    const { log, records } = capture()
    const job = outboxMonitorJob({ db: async () => db, log })
    await job.run()
    await job.run()
    expect(records().map((r) => r.event)).toEqual(['outbox.monitor_schema_mismatch'])
  })
})

describe('job isolation in the worker', () => {
  it('a failing database job does not stop wallet expiry', async () => {
    const controller = new AbortController()
    const wallet = createWalletService({ store: memoryWalletStore(), secret: 'test' })
    await wallet.accrue('bob', 1_000_000, 'o1', new Date('2025-09-01T00:00:00Z'))
    const { log } = capture()
    const failed: string[] = []
    const brokenDb = async (): Promise<SqlExecutor> => {
      throw new Error('connection refused')
    }
    await runWorker({
      jobs: [
        accountsCleanupJob({ db: brokenDb, log }),
        walletExpireJob({ wallet: async () => wallet, log, now: () => NOW }),
        { name: 'stop', run: async () => controller.abort() },
      ],
      tickMs: 1,
      signal: controller.signal,
      log: (e) => {
        if (e.event === 'worker.job_failed') failed.push(e.job)
      },
    })
    expect(failed).toEqual(['accounts.cleanup'])
    expect(await wallet.balance('bob', NOW)).toBe(0)
  })
})
