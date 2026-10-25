import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from '@payloadcms/db-postgres/drizzle/pg-core'

/**
 * Служебные таблицы (T-050, rules.md §4): общий счётчик ограничения частоты запросов — чтобы
 * лимиты входа, заявок и оформления держались при нескольких экземплярах приложения.
 * Подключается к схеме Payload через `beforeSchemaInit` (payload.config.ts).
 */

/**
 * Окно счётчика: `key_hash` — SHA-256 от «имя лимита + ключ» (почта или IP в базу не попадают),
 * `window_start` — начало фиксированного окна. Старые окна удаляет worker (accounts.cleanup).
 */
export const rateLimits = pgTable(
  'ops_rate_limits',
  {
    keyHash: text('key_hash').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    /** Имя лимита (`auth.password.ip`…) — для разбора в логах и чистки; не персональные данные. */
    bucket: text('bucket').notNull(),
    hits: integer('hits').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.keyHash, t.windowStart] }),
    index('ops_rate_limits_expires_idx').on(t.expiresAt),
  ],
)

export const opsTables = {
  ops_rate_limits: rateLimits,
}
