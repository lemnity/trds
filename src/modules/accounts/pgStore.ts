import { and, desc, eq, gte, gt, isNull, ne, sql } from '@payloadcms/db-postgres/drizzle'
import type { NodePgDatabase } from '@payloadcms/db-postgres/drizzle/node-postgres'

import { authCodes, consents, customers, identities, sessions } from '@/db/schema/accounts'

import type { AuthStore, CodeRow } from './service'

type Db = NodePgDatabase<Record<string, never>>

/** Хранилище кабинета в PostgreSQL (таблицы src/db/schema/accounts.ts). */
export function pgAuthStore(db: Db): AuthStore {
  return {
    async insertCode(row) {
      await db.insert(authCodes).values(row)
    },
    async codesSince(email, since) {
      const rows = await db
        .select()
        .from(authCodes)
        .where(and(eq(authCodes.email, email), gte(authCodes.createdAt, since)))
        .orderBy(desc(authCodes.createdAt))
      return rows as CodeRow[]
    },
    async addAttempt(id) {
      const [row] = await db
        .update(authCodes)
        .set({ attempts: sql`${authCodes.attempts} + 1` })
        .where(eq(authCodes.id, id))
        .returning({ attempts: authCodes.attempts })
      return row?.attempts ?? 0
    },
    async consumeCode(id, at) {
      // Условный переход: гасим, только если код ещё не погашен — параллельный вход не пройдёт.
      const rows = await db
        .update(authCodes)
        .set({ consumedAt: at })
        .where(and(eq(authCodes.id, id), isNull(authCodes.consumedAt)))
        .returning({ id: authCodes.id })
      return rows.length === 1
    },
    async findCustomer(email) {
      const [row] = await db
        .select({
          id: customers.id,
          email: customers.email,
          name: customers.name,
          passwordHash: customers.passwordHash,
        })
        .from(customers)
        .where(eq(customers.email, email))
      return row ?? null
    },
    async findCustomerById(id) {
      const [row] = await db
        .select({
          id: customers.id,
          email: customers.email,
          name: customers.name,
          passwordHash: customers.passwordHash,
        })
        .from(customers)
        .where(eq(customers.id, id))
      return row ?? null
    },
    async insertCustomer(customer) {
      // Два параллельных первых входа одной почтой — второй получает уже созданного покупателя.
      await db.insert(customers).values(customer).onConflictDoNothing({ target: customers.email })
      const [row] = await db
        .select({
          id: customers.id,
          email: customers.email,
          name: customers.name,
          passwordHash: customers.passwordHash,
        })
        .from(customers)
        .where(eq(customers.email, customer.email))
      return row!
    },
    async setCustomerName(id, name) {
      await db
        .update(customers)
        .set({ name })
        .where(and(eq(customers.id, id), isNull(customers.name)))
    },
    async setCustomerPassword(id, passwordHash) {
      await db
        .update(customers)
        .set({ passwordHash })
        .where(and(eq(customers.id, id), isNull(customers.passwordHash)))
    },
    async updateCustomerPassword(id, passwordHash) {
      await db.update(customers).set({ passwordHash }).where(eq(customers.id, id))
    },
    async insertSession(row) {
      await db.insert(sessions).values(row)
    },
    async findSession(tokenHash) {
      const [row] = await db
        .select({
          session: sessions,
          customer: { id: customers.id, email: customers.email, name: customers.name },
        })
        .from(sessions)
        .innerJoin(customers, eq(customers.id, sessions.customerId))
        .where(eq(sessions.tokenHash, tokenHash))
      return row ? { ...row.session, customer: row.customer } : null
    },
    async revokeSession(tokenHash, at) {
      await db
        .update(sessions)
        .set({ revokedAt: at })
        .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
    },
    async revokeCustomerSessions(customerId, at, exceptTokenHash) {
      await db
        .update(sessions)
        .set({ revokedAt: at })
        .where(
          and(
            eq(sessions.customerId, customerId),
            isNull(sessions.revokedAt),
            // Истёкшие не трогаем — они и так недействительны.
            gt(sessions.expiresAt, at),
            ...(exceptTokenHash ? [ne(sessions.tokenHash, exceptTokenHash)] : []),
          ),
        )
    },
    async findIdentity(provider, subject) {
      const [row] = await db
        .select()
        .from(identities)
        .where(and(eq(identities.provider, provider), eq(identities.subject, subject)))
      return row ?? null
    },
    async identitiesOf(customerId) {
      return db.select().from(identities).where(eq(identities.customerId, customerId))
    },
    async insertIdentity(row) {
      // Обе уникальности (аккаунт провайдера; провайдер у покупателя) — без исключения при гонке.
      const rows = await db
        .insert(identities)
        .values(row)
        .onConflictDoNothing()
        .returning({ id: identities.id })
      return rows.length === 1
    },
    async deleteIdentity(customerId, provider) {
      await db
        .delete(identities)
        .where(and(eq(identities.customerId, customerId), eq(identities.provider, provider)))
    },
  }
}

/** Запись в журнал согласий (152-ФЗ): документ, версия, контекст, время. */
export async function recordConsent(
  db: Db,
  entry: {
    id: string
    email: string
    document: string
    version: string
    context: string
    givenAt: Date
  },
) {
  await db.insert(consents).values(entry)
}
