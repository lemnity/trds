import { sql, type SQL } from '@payloadcms/db-postgres/drizzle'

import type { OutboxItem, OutboxQueue } from './outbox'

/**
 * Очередь outbox на PostgreSQL (`commerce_outbox`, src/db/schema/commerce.ts). Каждая операция —
 * один оператор вне долгой транзакции: блокировка строк длится только время UPDATE, отправка
 * письма идёт уже без блокировок (rules.md §2). Индекс `commerce_outbox_status_next_idx`
 * покрывает выборку готовых событий.
 */

type Executor = {
  execute: (query: SQL) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>
}

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`

const toItem = (r: Record<string, unknown>): OutboxItem => ({
  id: String(r.id),
  kind: String(r.kind),
  dedupeKey: String(r.dedupe_key),
  aggregateId: String(r.aggregate_id),
  payload: (r.payload ?? {}) as Record<string, unknown>,
  attempts: Number(r.attempts),
  createdAt: new Date(r.created_at as string | Date),
})

export function pgOutboxQueue(db: Executor): OutboxQueue {
  // Переход только из «нашей» попытки: статус processing и тот же номер attempts.
  const finish = async (item: OutboxItem, set: SQL) => {
    const result = await db.execute(sql`
      update commerce_outbox set ${set}
      where id = ${item.id} and status = 'processing' and attempts = ${item.attempts}`)
    return (result.rowCount ?? 0) === 1
  }

  return {
    async claim({ kinds, now, limit, leaseMs }) {
      if (!kinds.length) return []
      const result = await db.execute(sql`
        with picked as (
          select id from commerce_outbox
          where kind in (${sql.join(
            kinds.map((k) => sql`${k}`),
            sql`, `,
          )})
            and status in ('pending', 'processing')
            and next_attempt_at <= ${ts(now)}
          order by next_attempt_at, id
          limit ${limit}
          for update skip locked
        )
        update commerce_outbox o
        set status = 'processing', attempts = o.attempts + 1,
            next_attempt_at = ${ts(new Date(now.getTime() + leaseMs))}
        from picked where o.id = picked.id
        returning o.id, o.kind, o.dedupe_key, o.aggregate_id, o.payload, o.attempts, o.created_at`)
      return result.rows
        .map(toItem)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
    },
    complete: (item, now) =>
      finish(item, sql`status = 'done', processed_at = ${ts(now)}, last_error = null`),
    retry: (item, at, error) =>
      finish(item, sql`status = 'pending', next_attempt_at = ${ts(at)}, last_error = ${error}`),
    // processed_at остаётся пустым: outbox.monitor продолжает сигналить, пока событие не разберут.
    bury: (item, now, error) =>
      finish(item, sql`status = 'dead', next_attempt_at = ${ts(now)}, last_error = ${error}`),
  }
}
