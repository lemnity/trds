import { sql } from '@payloadcms/db-postgres/drizzle'
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from '@payloadcms/db-postgres/drizzle/pg-core'

/**
 * Заявки на корпоративы (T-034, PRD §5.7, architecture.md `leads`) и журнал согласий (OPS-02).
 * Подключаются к схеме Payload через `beforeSchemaInit` (payload.config.ts), как таблицы кабинета.
 * Статусы — колонки будущего канбана (T-065): «Новые», «В работе», «Готово»; переходы — строками
 * истории, саму заявку не переписываем задним числом.
 */

export const LEAD_STATUSES = ['new', 'in_progress', 'done'] as const

export const leadRequests = pgTable(
  'leads_requests',
  {
    id: uuid('id').primaryKey(),
    status: text('status', { enum: LEAD_STATUSES }).notNull().default('new'),
    format: text('format').notNull(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    eventDate: date('event_date', { mode: 'string' }),
    guests: integer('guests'),
    budget: text('budget'),
    comment: text('comment'),
    /** Откуда пришла заявка (страница сайта). */
    source: text('source').notNull(),
    /** Ключ отправки из формы: повтор того же нажатия не создаёт вторую заявку. */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    /** SHA-256 содержимого: тот же ключ с другим текстом — конфликт, а не тихая подмена. */
    payloadHash: text('payload_hash').notNull(),
    /**
     * Похоже на повтор — тот же контакт за последние сутки. Не скрываем и не сливаем:
     * карточка в канбане помечается, решает сотрудник.
     */
    duplicateOf: uuid('duplicate_of').references((): AnyPgColumn => leadRequests.id, {
      onDelete: 'set null',
    }),
    /** Уведомление театра ещё не отправлено (worker/outbox — TODO, см. lead-requests). */
    notifyPending: boolean('notify_pending').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('leads_requests_status_created_idx').on(t.status, t.createdAt),
    index('leads_requests_email_idx').on(t.email),
    index('leads_requests_phone_idx').on(t.phone),
    index('leads_requests_notify_idx')
      .on(t.createdAt)
      .where(sql`${t.notifyPending}`),
    check('leads_requests_contact', sql`${t.email} IS NOT NULL OR ${t.phone} IS NOT NULL`),
    check(
      'leads_requests_guests',
      sql`${t.guests} IS NULL OR (${t.guests} >= 1 AND ${t.guests} <= 1000)`,
    ),
    check('leads_requests_status', sql`${t.status} IN ('new', 'in_progress', 'done')`),
  ],
)

/** История статусов: кто и когда перевёл карточку. `actor` пуст — заявку создал посетитель. */
export const leadStatusHistory = pgTable(
  'leads_status_history',
  {
    id: uuid('id').primaryKey(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leadRequests.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status', { enum: LEAD_STATUSES }),
    toStatus: text('to_status', { enum: LEAD_STATUSES }).notNull(),
    /** id сотрудника Payload (T-065); пусто — посетитель сайта. */
    actor: text('actor'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('leads_status_history_lead_idx').on(t.leadId, t.createdAt)],
)

/**
 * Журнал согласий без персональных данных: документ, версия, где и когда, ссылка на объект
 * (`lead:<uuid>`). Контакт — в самой заявке; удалили заявку — запись остаётся доказательством.
 */
export const consentJournal = pgTable(
  'consent_journal',
  {
    id: uuid('id').primaryKey(),
    document: text('document').notNull(),
    version: text('version').notNull(),
    context: text('context').notNull(),
    subjectRef: text('subject_ref').notNull(),
    givenAt: timestamp('given_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('consent_journal_subject_idx').on(t.subjectRef)],
)

export const leadsTables = {
  leads_requests: leadRequests,
  leads_status_history: leadStatusHistory,
  consent_journal: consentJournal,
}
