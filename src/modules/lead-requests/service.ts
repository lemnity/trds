import { createHash, randomUUID } from 'node:crypto'

import { CONSENT_DOCUMENTS, type ConsentRecord } from '@/modules/consent'
import { parseLead, type Lead, type LeadErrors } from '@/modules/leads'

import type { LeadAuditRow, LeadBoardStore, LeadCard } from './board'

/**
 * Приём заявки на корпоратив (T-034, PRD §5.7). Только сервер. Разбор полей — `modules/leads`
 * (та же проверка, что в форме). Заявка, первая строка истории статусов и запись журнала
 * согласия пишутся одной транзакцией. Повтор той же отправки (ключ идемпотентности из формы)
 * возвращает уже созданную заявку; новая заявка с тем же контактом за сутки помечается
 * `duplicateOf` — видна сотруднику, а не прячется и не сливается. В той же транзакции пишется
 * событие outbox `lead.created`: worker отправит письмо театру (src/jobs/tasks/outbox-leads.ts).
 */

export const LEAD_STATUS_LABELS = {
  new: 'Новая',
  in_progress: 'В работе',
  done: 'Готово',
  archived: 'Архив',
} as const
export type LeadStatus = keyof typeof LEAD_STATUS_LABELS

/** Вид события outbox «новая заявка» и его ключ: одно письмо театру на заявку. */
export const LEAD_CREATED_KIND = 'lead.created'
export const leadCreatedDedupeKey = (leadId: string) => `${LEAD_CREATED_KIND}:${leadId}`

/**
 * Событие outbox (таблица `commerce_outbox`). В payload — только id заявки, без контактов:
 * обработчик сам читает заявку, а очередь и её журнал ошибок персональных данных не содержат.
 */
export type LeadOutboxRow = {
  id: string
  kind: typeof LEAD_CREATED_KIND
  dedupeKey: string
  aggregateId: string
  payload: { leadId: string }
  status: 'pending'
  attempts: 0
  nextAttemptAt: Date
  createdAt: Date
}

/** Окно поиска похожей заявки (тот же контакт). */
export const DUPLICATE_WINDOW_MS = 24 * 3_600_000

/** Ключ из формы: случайный UUID или похожая строка. */
export const IDEMPOTENCY_KEY_PATTERN = /^[\w-]{16,64}$/

export type LeadRow = {
  id: string
  status: LeadStatus
  format: Lead['format']
  name: string
  email: string | null
  phone: string | null
  eventDate: string | null
  guests: number | null
  budget: string | null
  comment: string | null
  source: string
  idempotencyKey: string
  payloadHash: string
  duplicateOf: string | null
  /** Ответственный сотрудник (id в `admin-users`). */
  assignee: string | null
  createdAt: Date
  updatedAt: Date
}

export type LeadHistoryRow = {
  id: string
  leadId: string
  fromStatus: LeadStatus | null
  toStatus: LeadStatus
  actor: string | null
  createdAt: Date
}

export type CreateOutcome =
  { created: true } | { created: false; existing: { id: string; payloadHash: string } }

export interface LeadStore {
  /**
   * Атомарно: заявка + история + согласие + событие outbox. Если заявка с таким ключом уже
   * есть — ничего не пишет и возвращает её (в том числе при двух параллельных отправках).
   */
  create(input: {
    lead: LeadRow
    history: LeadHistoryRow
    consent: ConsentRecord
    outbox: LeadOutboxRow
  }): Promise<CreateOutcome>
  /** id последней заявки с той же почтой или телефоном, созданной не раньше `since`. */
  findRecentByContact(
    contact: { email?: string; phone?: string },
    since: Date,
  ): Promise<string | null>
}

export type SubmitResult =
  | { ok: true; status: LeadStatus; replay: boolean }
  | { ok: false; error: 'invalid'; fields: LeadErrors }
  | { ok: false; error: 'invalid_key' }
  | { ok: false; error: 'conflict' }

const EMPTY_FORM = { email: '', phone: '', date: '', guests: '', budget: '', comment: '' }

/** Хеш содержимого заявки: ключи по алфавиту, чтобы порядок полей не влиял. */
const hashLead = (lead: Lead, source: string) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries({ ...lead, source }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    )
    .digest('hex')

export function createLeadRequestService({
  store,
  now = () => new Date(),
}: {
  store: LeadStore
  now?: () => Date
}) {
  async function submit(input: {
    form: unknown
    idempotencyKey: unknown
    source: string
  }): Promise<SubmitResult> {
    const key = input.idempotencyKey
    if (typeof key !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(key))
      return { ok: false, error: 'invalid_key' }
    const at = now()
    // Необязательные поля можно не присылать: пустая строка — как пустое поле формы.
    const form =
      input.form && typeof input.form === 'object'
        ? { ...EMPTY_FORM, ...(input.form as Record<string, unknown>) }
        : input.form
    const parsed = parseLead(form, at)
    if (!parsed.ok) return { ok: false, error: 'invalid', fields: parsed.errors }
    const lead = parsed.value
    const payloadHash = hashLead(lead, input.source)

    const duplicateOf = await store.findRecentByContact(
      { email: lead.email, phone: lead.phone },
      new Date(at.getTime() - DUPLICATE_WINDOW_MS),
    )
    const id = randomUUID()
    const outcome = await store.create({
      lead: {
        id,
        status: 'new',
        format: lead.format,
        name: lead.name,
        email: lead.email ?? null,
        phone: lead.phone ?? null,
        eventDate: lead.date ?? null,
        guests: lead.guests ?? null,
        budget: lead.budget ?? null,
        comment: lead.comment ?? null,
        source: input.source,
        idempotencyKey: key,
        payloadHash,
        duplicateOf,
        assignee: null,
        createdAt: at,
        updatedAt: at,
      },
      history: {
        id: randomUUID(),
        leadId: id,
        fromStatus: null,
        toStatus: 'new',
        actor: null,
        createdAt: at,
      },
      consent: {
        id: randomUUID(),
        document: 'personal-data',
        version: CONSENT_DOCUMENTS['personal-data'].version,
        context: 'lead',
        subjectRef: `lead:${id}`,
        givenAt: at,
      },
      outbox: {
        id: randomUUID(),
        kind: LEAD_CREATED_KIND,
        dedupeKey: leadCreatedDedupeKey(id),
        aggregateId: id,
        payload: { leadId: id },
        status: 'pending',
        attempts: 0,
        nextAttemptAt: at,
        createdAt: at,
      },
    })
    if (outcome.created) return { ok: true, status: 'new', replay: false }
    // Тот же ключ с другим содержимым — не подменяем заявку молча.
    if (outcome.existing.payloadHash !== payloadHash) return { ok: false, error: 'conflict' }
    return { ok: true, status: 'new', replay: true }
  }

  return { submit }
}

export type LeadRequestService = ReturnType<typeof createLeadRequestService>

/** Хранилище в памяти — для тестов и разработки без базы. Не для production. */
export function memoryLeadStore(): LeadStore &
  LeadBoardStore & {
    dump: () => {
      leads: LeadRow[]
      history: LeadHistoryRow[]
      consents: ConsentRecord[]
      outbox: LeadOutboxRow[]
      audit: LeadAuditRow[]
    }
  } {
  const leads: LeadRow[] = []
  const history: LeadHistoryRow[] = []
  const consents: ConsentRecord[] = []
  const outbox: LeadOutboxRow[] = []
  const audit: LeadAuditRow[] = []
  const card = (l: LeadRow): LeadCard => ({
    id: l.id,
    status: l.status,
    format: l.format,
    name: l.name,
    eventDate: l.eventDate,
    guests: l.guests,
    assignee: l.assignee,
    createdAt: l.createdAt,
    duplicate: l.duplicateOf !== null,
  })
  return {
    async create(input) {
      const existing = leads.find((l) => l.idempotencyKey === input.lead.idempotencyKey)
      if (existing)
        return { created: false, existing: { id: existing.id, payloadHash: existing.payloadHash } }
      leads.push({ ...input.lead })
      history.push({ ...input.history })
      consents.push({ ...input.consent })
      // Как уникальный dedupe_key в commerce_outbox: второе событие на ту же заявку не пишется.
      if (!outbox.some((o) => o.dedupeKey === input.outbox.dedupeKey))
        outbox.push({ ...input.outbox })
      return { created: true }
    },
    async findRecentByContact({ email, phone }, since) {
      const match = leads
        .filter(
          (l) =>
            l.createdAt >= since && ((email && l.email === email) || (phone && l.phone === phone)),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
      return match?.id ?? null
    },
    async listCards(archiveLimit) {
      const newest = [...leads].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      return [
        ...newest.filter((l) => l.status !== 'archived'),
        ...newest.filter((l) => l.status === 'archived').slice(0, archiveLimit),
      ].map(card)
    },
    async findLead(id) {
      const l = leads.find((x) => x.id === id)
      return l ? { ...l } : null
    },
    async historyOf(id) {
      return history.filter((h) => h.leadId === id).map((h) => ({ ...h }))
    },
    async transition({ id, from, to, at, history: row, audit: entry }) {
      const l = leads.find((x) => x.id === id && x.status === from)
      if (!l) return false
      l.status = to
      l.updatedAt = at
      history.push({ ...row })
      audit.push({ ...entry })
      return true
    },
    async assign({ id, expected, assignee, at, audit: entry }) {
      const l = leads.find((x) => x.id === id && x.assignee === expected)
      if (!l) return false
      l.assignee = assignee
      l.updatedAt = at
      audit.push({ ...entry })
      return true
    },
    dump: () => ({
      leads: leads.map((l) => ({ ...l })),
      history: history.map((h) => ({ ...h })),
      consents: consents.map((c) => ({ ...c })),
      outbox: outbox.map((o) => ({ ...o })),
      audit: audit.map((a) => ({ ...a })),
    }),
  }
}
