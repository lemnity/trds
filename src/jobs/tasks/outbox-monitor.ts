import { sql } from '@payloadcms/db-postgres/drizzle'

import { ALERTS, type Logger } from '@/lib/log'

import type { Job } from '../worker'
import type { SqlExecutor } from './types'

export const OUTBOX_STUCK_AFTER_MS = 30 * 60 * 1000

/**
 * Сигнал о зависшем outbox (architecture.md §15): необработанные события старше порога.
 * Таблица `commerce_outbox` (src/db/schema/commerce.ts, T-045) ещё не во всех БД; без неё задача
 * ничего не делает. Колонки проверяются по information_schema, чтобы смена схемы не превращалась
 * в ежетактовую ошибку: без нужных колонок — warn в лог и пропуск.
 */
const OUTBOX_TABLE = 'commerce_outbox'
export const outboxMonitorJob = ({
  db,
  log,
  now = () => new Date(),
  stuckAfterMs = OUTBOX_STUCK_AFTER_MS,
}: {
  db: () => Promise<SqlExecutor>
  log: Logger
  now?: () => Date
  stuckAfterMs?: number
}): Job => {
  let warnedSchema = false
  return {
    name: 'outbox.monitor',
    run: async () => {
      const conn = await db()
      const columns = await conn.execute(sql`
        select count(*)::int as n from information_schema.columns
        where table_schema = current_schema() and table_name = ${OUTBOX_TABLE}
          and column_name in ('processed_at', 'created_at')`)
      const n = Number(columns.rows[0]?.n ?? 0)
      if (n === 0) return
      if (n < 2) {
        if (!warnedSchema) log.warn('outbox.monitor_schema_mismatch', { job: 'outbox.monitor' })
        warnedSchema = true
        return
      }
      const before = new Date(now().getTime() - stuckAfterMs).toISOString()
      const result = await conn.execute(sql`
        select count(*)::int as stuck, min(created_at) as oldest from ${sql.identifier(OUTBOX_TABLE)}
        where processed_at is null and created_at < ${before}::timestamptz`)
      const stuck = Number(result.rows[0]?.stuck ?? 0)
      if (stuck > 0)
        log.alert(ALERTS.outboxStuck, {
          job: 'outbox.monitor',
          stuck,
          oldest: result.rows[0]?.oldest,
          thresholdMinutes: Math.round(stuckAfterMs / 60000),
        })
    },
  }
}
