import { sql, type SQL } from '@payloadcms/db-postgres/drizzle'
import { drizzle } from '@payloadcms/db-postgres/drizzle/node-postgres'

import { databaseUrl } from './env'

/**
 * Прямой доступ к одноразовой базе прогона: подготовка данных (политика возвратов) и проверки
 * инвариантов, которые UI не показывает (число заявок, проданные места). Тот же драйвер, что
 * у Payload и тестов на PostgreSQL (`tests/unit/*-pg.test.ts`), — без новой зависимости.
 */

export type Db = ReturnType<typeof drizzle>

export const openDb = (url: string = databaseUrl()): Db =>
  drizzle({ connection: { connectionString: url, max: 4 } })

export const closeDb = (db: Db) => db.$client.end()

/** Строки запроса как обычные объекты. */
export async function rows<T extends Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  const result = await db.execute(query)
  return result.rows as T[]
}

/** Один запрос с открытием/закрытием соединения — для тестов, которым нужна пара проверок. */
export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = openDb()
  try {
    return await fn(db)
  } finally {
    await closeDb(db)
  }
}

export { sql }
