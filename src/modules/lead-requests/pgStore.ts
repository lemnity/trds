import { and, desc, eq, gte, or, type SQL } from '@payloadcms/db-postgres/drizzle'
import type { NodePgDatabase } from '@payloadcms/db-postgres/drizzle/node-postgres'

import { consentJournal, leadRequests, leadStatusHistory } from '@/db/schema/leads'

import type { LeadStore } from './service'

type Db = NodePgDatabase<Record<string, never>>

/** Хранилище заявок в PostgreSQL (таблицы src/db/schema/leads.ts). */
export function pgLeadStore(db: Db): LeadStore {
  return {
    async create({ lead, history, consent }) {
      return db.transaction(async (tx) => {
        // Уникальный ключ отправки: параллельный повтор не вставит вторую строку и не упадёт.
        const inserted = await tx
          .insert(leadRequests)
          .values(lead)
          .onConflictDoNothing({ target: leadRequests.idempotencyKey })
          .returning({ id: leadRequests.id })
        if (inserted.length === 0) {
          const [existing] = await tx
            .select({ id: leadRequests.id, payloadHash: leadRequests.payloadHash })
            .from(leadRequests)
            .where(eq(leadRequests.idempotencyKey, lead.idempotencyKey))
          if (!existing) throw new Error('lead idempotency conflict without a row')
          return { created: false as const, existing }
        }
        await tx.insert(leadStatusHistory).values(history)
        await tx.insert(consentJournal).values(consent)
        return { created: true as const }
      })
    },
    async findRecentByContact({ email, phone }, since) {
      const contact: SQL[] = []
      if (email) contact.push(eq(leadRequests.email, email))
      if (phone) contact.push(eq(leadRequests.phone, phone))
      if (contact.length === 0) return null
      const [row] = await db
        .select({ id: leadRequests.id })
        .from(leadRequests)
        .where(and(gte(leadRequests.createdAt, since), or(...contact)))
        .orderBy(desc(leadRequests.createdAt))
        .limit(1)
      return row?.id ?? null
    },
  }
}
