import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from '@payloadcms/db-postgres/drizzle/pg-core'

/**
 * Доменные таблицы кабинета зрителя (T-050, architecture.md §6): покупатели, одноразовые коды,
 * сессии, журнал согласий. Подключаются к схеме Payload через `beforeSchemaInit`
 * (payload.config.ts) — чтобы синхронизация и миграции Payload их видели и не удаляли.
 */

export const customers = pgTable('accounts_customers', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  /** scrypt$N$r$p$соль$хеш — пароль не хранится (T-055). */
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

/** Только HMAC-хеш кода; сам код нигде не хранится и не логируется. */
export const authCodes = pgTable(
  'accounts_auth_codes',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    purpose: text('purpose', { enum: ['login', 'register', 'password'] }).notNull(),
    name: text('name'),
    passwordHash: text('password_hash'),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('accounts_auth_codes_email_created_idx').on(t.email, t.createdAt)],
)

/** Только SHA-256 токена сессии; сам токен живёт в HttpOnly cookie браузера. */
export const sessions = pgTable(
  'accounts_sessions',
  {
    id: uuid('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('accounts_sessions_customer_idx').on(t.customerId)],
)

/** Журнал согласий: какой документ, какой версии, когда; почта — как при согласии. */
export const consents = pgTable('accounts_consents', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  document: text('document').notNull(),
  version: text('version').notNull(),
  context: text('context').notNull(),
  givenAt: timestamp('given_at', { withTimezone: true }).notNull(),
})

/**
 * Внешние способы входа (T-056): какой аккаунт провайдера привязан к покупателю. `subject` —
 * постоянный идентификатор пользователя у провайдера (`id` из login.yandex.ru/info); почта и имя
 * не дублируются. Один аккаунт провайдера — один покупатель, у покупателя — один на провайдера.
 */
export const identities = pgTable(
  'accounts_identities',
  {
    id: uuid('id').primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['yandex'] }).notNull(),
    subject: text('subject').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('accounts_identities_provider_subject_uq').on(t.provider, t.subject),
    uniqueIndex('accounts_identities_customer_provider_uq').on(t.customerId, t.provider),
  ],
)

export const accountsTables = {
  accounts_customers: customers,
  accounts_auth_codes: authCodes,
  accounts_sessions: sessions,
  accounts_consents: consents,
  accounts_identities: identities,
}
