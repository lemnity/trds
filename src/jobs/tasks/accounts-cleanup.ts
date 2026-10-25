import { sql } from '@payloadcms/db-postgres/drizzle'

import { authCodes, sessions } from '@/db/schema/accounts'
import type { Logger } from '@/lib/log'

import type { Job } from '../worker'
import type { SqlExecutor } from './types'

/**
 * Хранение технических данных входа (architecture.md §12). Политика хранения театром ещё не
 * утверждена — значения консервативные и меняются здесь:
 * - коды входа: удаляются через сутки после истечения (TTL 10 минут, лимит отправок считается
 *   за последний час — суточный запас его не задевает);
 * - сессии: через 30 дней после истечения или отзыва.
 */
export const ACCOUNTS_RETENTION = {
  authCodesAfterExpiryMs: 24 * 60 * 60 * 1000,
  sessionsAfterEndMs: 30 * 24 * 60 * 60 * 1000,
} as const

export const ACCOUNTS_CLEANUP_EVERY_MS = 60 * 60 * 1000
// Удаляем пачками: короткие транзакции, без долгих блокировок таблиц входа.
export const CLEANUP_BATCH = 1000

const deleteBatch = async (db: SqlExecutor, query: ReturnType<typeof sql>) => {
  let total = 0
  for (;;) {
    const result = await db.execute(query)
    const count = result.rowCount ?? result.rows.length
    total += count
    if (count < CLEANUP_BATCH) return total
  }
}

/**
 * Чистка истёкших кодов и сессий. Идемпотентна (повтор удаляет то же или ничего), безопасна при
 * нескольких worker (SKIP LOCKED). Таблицы — из src/db/schema/accounts.ts; код кабинета не трогает.
 */
export const accountsCleanupJob = ({
  db,
  log,
  now = () => new Date(),
  everyMs = ACCOUNTS_CLEANUP_EVERY_MS,
}: {
  db: () => Promise<SqlExecutor>
  log: Logger
  now?: () => Date
  everyMs?: number
}): Job => ({
  name: 'accounts.cleanup',
  everyMs,
  run: async () => {
    const conn = await db()
    const at = now().getTime()
    const codesBefore = new Date(at - ACCOUNTS_RETENTION.authCodesAfterExpiryMs).toISOString()
    const sessionsBefore = new Date(at - ACCOUNTS_RETENTION.sessionsAfterEndMs).toISOString()

    const codes = await deleteBatch(
      conn,
      sql`with doomed as (
        select ${authCodes.id} as id from ${authCodes}
        where ${authCodes.expiresAt} < ${codesBefore}::timestamptz
        limit ${CLEANUP_BATCH} for update skip locked
      )
      delete from ${authCodes} where ${authCodes.id} in (select id from doomed)`,
    )
    const ended = await deleteBatch(
      conn,
      sql`with doomed as (
        select ${sessions.id} as id from ${sessions}
        where ${sessions.expiresAt} < ${sessionsBefore}::timestamptz
           or ${sessions.revokedAt} < ${sessionsBefore}::timestamptz
        limit ${CLEANUP_BATCH} for update skip locked
      )
      delete from ${sessions} where ${sessions.id} in (select id from doomed)`,
    )
    if (codes > 0 || ended > 0)
      log.info('accounts.cleaned', {
        job: 'accounts.cleanup',
        codesDeleted: codes,
        sessionsDeleted: ended,
      })
  },
})
