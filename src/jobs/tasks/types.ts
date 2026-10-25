import type { SQL } from '@payloadcms/db-postgres/drizzle'

/** Минимум от соединения drizzle, нужный SQL-задачам (тесты подставляют фейк). */
export type SqlExecutor = {
  execute: (query: SQL) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>
}
