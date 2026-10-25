import { and, asc, desc, eq, gte, isNull, ne, or, type SQL } from '@payloadcms/db-postgres/drizzle'
import type { NodePgDatabase } from '@payloadcms/db-postgres/drizzle/node-postgres'

import { commerceAuditLog, commerceOutbox } from '@/db/schema/commerce'
import { consentJournal, leadRequests, leadStatusHistory } from '@/db/schema/leads'

import type { LeadBoardStore, LeadCard } from './board'
import type { LeadNotice } from './notifications'
import type { LeadStore } from './service'

type Db = NodePgDatabase<Record<string, never>>

const cardColumns = {
  id: leadRequests.id,
  status: leadRequests.status,
  format: leadRequests.format,
  name: leadRequests.name,
  eventDate: leadRequests.eventDate,
  guests: leadRequests.guests,
  assignee: leadRequests.assignee,
  createdAt: leadRequests.createdAt,
  duplicateOf: leadRequests.duplicateOf,
}

type CardRow = Omit<LeadCard, 'duplicate' | 'format'> & {
  format: string
  duplicateOf: string | null
}

const toCard = ({ duplicateOf, ...r }: CardRow): LeadCard => ({
  ...r,
  format: r.format as LeadCard['format'],
  duplicate: duplicateOf !== null,
})

/** Хранилище заявок в PostgreSQL (таблицы src/db/schema/leads.ts). */
export function pgLeadStore(db: Db): LeadStore & LeadBoardStore {
  return {
    async create({ lead, history, consent, outbox }) {
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
        // Письмо театру — через outbox; уникальный dedupe_key не даст второго события.
        await tx
          .insert(commerceOutbox)
          .values(outbox)
          .onConflictDoNothing({ target: commerceOutbox.dedupeKey })
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

    // --- Канбан (T-065) ---

    async listCards(archiveLimit) {
      const [active, archived] = await Promise.all([
        db
          .select(cardColumns)
          .from(leadRequests)
          .where(ne(leadRequests.status, 'archived'))
          .orderBy(desc(leadRequests.createdAt)),
        db
          .select(cardColumns)
          .from(leadRequests)
          .where(eq(leadRequests.status, 'archived'))
          .orderBy(desc(leadRequests.updatedAt))
          .limit(archiveLimit),
      ])
      return [...active, ...archived].map(toCard)
    },
    async findLead(id) {
      const [row] = await db.select().from(leadRequests).where(eq(leadRequests.id, id))
      return row ? { ...row, format: row.format as LeadCard['format'] } : null
    },
    async historyOf(id) {
      return db
        .select()
        .from(leadStatusHistory)
        .where(eq(leadStatusHistory.leadId, id))
        .orderBy(asc(leadStatusHistory.createdAt))
    },
    async transition({ id, from, to, at, history, audit }) {
      return db.transaction(async (tx) => {
        // Условный переход: из статуса, который видел сотрудник; иначе — ничего не пишем.
        const moved = await tx
          .update(leadRequests)
          .set({ status: to, updatedAt: at })
          .where(and(eq(leadRequests.id, id), eq(leadRequests.status, from)))
          .returning({ id: leadRequests.id })
        if (moved.length !== 1) return false
        await tx.insert(leadStatusHistory).values(history)
        await tx.insert(commerceAuditLog).values(audit)
        return true
      })
    },
    async assign({ id, expected, assignee, at, audit }) {
      return db.transaction(async (tx) => {
        const done = await tx
          .update(leadRequests)
          .set({ assignee, updatedAt: at })
          .where(
            and(
              eq(leadRequests.id, id),
              expected === null
                ? isNull(leadRequests.assignee)
                : eq(leadRequests.assignee, expected),
            ),
          )
          .returning({ id: leadRequests.id })
        if (done.length !== 1) return false
        await tx.insert(commerceAuditLog).values(audit)
        return true
      })
    },
  }
}

/** Данные для письма театру (без контактов заявителя) — обработчику outbox `lead.created`. */
export function pgLeadNoticeLookup(db: Db) {
  return async (id: string): Promise<LeadNotice | null> => {
    const [row] = await db
      .select({
        id: leadRequests.id,
        format: leadRequests.format,
        eventDate: leadRequests.eventDate,
        guests: leadRequests.guests,
        duplicateOf: leadRequests.duplicateOf,
        createdAt: leadRequests.createdAt,
      })
      .from(leadRequests)
      .where(eq(leadRequests.id, id))
    return row
      ? {
          id: row.id,
          format: row.format,
          eventDate: row.eventDate,
          guests: row.guests,
          duplicate: row.duplicateOf !== null,
          createdAt: row.createdAt,
        }
      : null
  }
}
