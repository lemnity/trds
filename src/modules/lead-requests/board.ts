import { randomUUID } from 'node:crypto'

import { LEAD_STATUS_LABELS, type LeadHistoryRow, type LeadRow, type LeadStatus } from './service'

/**
 * Канбан корпоративов (T-065, design.md §10, plan-main.md §7.2): колонки «Новые», «В работе»,
 * «Готово» и «Архив», ответственный, история переходов. Только сервер; права (администратор
 * театра с пройденной MFA) проверяет вызывающий — REST админки (src/payload/endpoints/leads.ts).
 *
 * Статус меняется только здесь (rules.md §3): условный переход «из того статуса, что видел
 * сотрудник» — две вкладки не перезапишут друг друга молча; заявка, строка истории и запись
 * журнала аудита — одной транзакцией хранилища.
 */

export const LEAD_STATUSES: readonly LeadStatus[] = ['new', 'in_progress', 'done', 'archived']

/**
 * Разрешённые переходы. Из архива — только обратно в «Новые» (заявку разбирают заново);
 * «Готово» можно вернуть в работу. Остальные — свободно, как перетаскивание карточки.
 */
export const LEAD_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ['in_progress', 'done', 'archived'],
  in_progress: ['new', 'done', 'archived'],
  done: ['in_progress', 'archived'],
  archived: ['new'],
}

export const canTransition = (from: LeadStatus, to: LeadStatus) =>
  LEAD_TRANSITIONS[from]?.includes(to) ?? false

export const isLeadStatus = (v: unknown): v is LeadStatus =>
  typeof v === 'string' && Object.hasOwn(LEAD_STATUS_LABELS, v)

/**
 * Письмо клиенту о смене статуса — только после решения театра (тексты и согласие на рассылку).
 * Пока выключено: переключатель в канбане показан неактивным, сервер такой запрос отклоняет.
 */
export const CLIENT_STATUS_EMAIL_ENABLED = false

/** Сколько последних заявок архива показывать в колонке. */
export const ARCHIVE_LIMIT = 50

/** Карточка: минимум персональных данных (имя, формат, дата, гости) — без контактов. */
export type LeadCard = Pick<
  LeadRow,
  'id' | 'status' | 'format' | 'name' | 'eventDate' | 'guests' | 'assignee' | 'createdAt'
> & { duplicate: boolean }

/** Подробности заявки — контакты, бюджет, комментарий и история; открываются по клику. */
export type LeadDetail = LeadCard &
  Pick<LeadRow, 'email' | 'phone' | 'budget' | 'comment' | 'source' | 'duplicateOf'> & {
    history: LeadHistoryRow[]
  }

/** Строка `commerce_audit_log` (ADMIN-02): без контактов — только id сотрудника и заявки. */
export type LeadAuditRow = {
  id: string
  actor: string
  action: 'cms.lead.move' | 'cms.lead.assign'
  entity: 'leads_requests'
  entityId: string
  reason: string
  result: 'ok'
  correlationId: string | null
  at: Date
}

export interface LeadBoardStore {
  /** Все незаархивированные заявки и последние `archiveLimit` из архива. */
  listCards(archiveLimit: number): Promise<LeadCard[]>
  findLead(id: string): Promise<LeadRow | null>
  historyOf(id: string): Promise<LeadHistoryRow[]>
  /**
   * Атомарно: статус меняется, только если он всё ещё `from`; тогда же — строка истории и аудит.
   * false — заявки нет или её уже перевёл кто-то другой (ничего не записано).
   */
  transition(input: {
    id: string
    from: LeadStatus
    to: LeadStatus
    at: Date
    history: LeadHistoryRow
    audit: LeadAuditRow
  }): Promise<boolean>
  /** Атомарно: ответственный меняется, только если он всё ещё `expected`; плюс аудит. */
  assign(input: {
    id: string
    expected: string | null
    assignee: string | null
    at: Date
    audit: LeadAuditRow
  }): Promise<boolean>
}

/** Кто действует: id сотрудника Payload и correlation ID запроса. */
export type LeadActor = { staffId: string; correlationId?: string | null }

export type MoveResult =
  | { ok: true; status: LeadStatus }
  | { ok: false; error: 'invalid' | 'invalid_transition' | 'client_email_disabled' | 'not_found' }
  | { ok: false; error: 'conflict'; status: LeadStatus }

export type AssignResult =
  | { ok: true; assignee: string | null }
  | { ok: false; error: 'invalid' | 'unknown_staff' | 'not_found' }
  | { ok: false; error: 'conflict'; assignee: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAFF_ID = /^[\w-]{1,64}$/

const auditActor = (actor: LeadActor) => `admin-users:${actor.staffId}`

export function createLeadBoardService({
  store,
  now = () => new Date(),
}: {
  store: LeadBoardStore
  now?: () => Date
}) {
  /** Конфликт или пропажа: перечитываем, чтобы сказать сотруднику, что именно случилось. */
  const whyNot = async (id: string) => store.findLead(id)

  return {
    board: () => store.listCards(ARCHIVE_LIMIT),

    async detail(id: string): Promise<LeadDetail | null> {
      if (!UUID.test(id)) return null
      const lead = await store.findLead(id)
      if (!lead) return null
      return {
        id: lead.id,
        status: lead.status,
        format: lead.format,
        name: lead.name,
        eventDate: lead.eventDate,
        guests: lead.guests,
        assignee: lead.assignee,
        createdAt: lead.createdAt,
        duplicate: lead.duplicateOf !== null,
        duplicateOf: lead.duplicateOf,
        email: lead.email,
        phone: lead.phone,
        budget: lead.budget,
        comment: lead.comment,
        source: lead.source,
        history: await store.historyOf(lead.id),
      }
    },

    /** Перевод карточки: `from` — статус, который видел сотрудник (защита от гонки). */
    async move(
      input: { id: unknown; from: unknown; to: unknown; notifyClient?: unknown },
      actor: LeadActor,
    ): Promise<MoveResult> {
      const { id, from, to } = input
      if (typeof id !== 'string' || !UUID.test(id) || !isLeadStatus(from) || !isLeadStatus(to))
        return { ok: false, error: 'invalid' }
      if (!canTransition(from, to)) return { ok: false, error: 'invalid_transition' }
      if (input.notifyClient === true && !CLIENT_STATUS_EMAIL_ENABLED)
        return { ok: false, error: 'client_email_disabled' }
      const at = now()
      const moved = await store.transition({
        id,
        from,
        to,
        at,
        history: {
          id: randomUUID(),
          leadId: id,
          fromStatus: from,
          toStatus: to,
          actor: actor.staffId,
          createdAt: at,
        },
        audit: {
          id: randomUUID(),
          actor: auditActor(actor),
          action: 'cms.lead.move',
          entity: 'leads_requests',
          entityId: id,
          reason: `${from} → ${to}`,
          result: 'ok',
          correlationId: actor.correlationId ?? null,
          at,
        },
      })
      if (moved) return { ok: true, status: to }
      const current = await whyNot(id)
      return current
        ? { ok: false, error: 'conflict', status: current.status }
        : { ok: false, error: 'not_found' }
    },

    /**
     * Назначение ответственного. `staffIds` — действующие сотрудники (список даёт вызывающий
     * из `admin-users`): назначить можно только существующего; `null` — снять.
     */
    async assign(
      input: { id: unknown; expected: unknown; assignee: unknown },
      actor: LeadActor,
      staffIds: ReadonlySet<string>,
    ): Promise<AssignResult> {
      const { id } = input
      const norm = (v: unknown) =>
        v === null || v === ''
          ? null
          : typeof v === 'string' || typeof v === 'number'
            ? String(v)
            : undefined
      const assignee = norm(input.assignee)
      const expected = norm(input.expected)
      if (
        typeof id !== 'string' ||
        !UUID.test(id) ||
        assignee === undefined ||
        expected === undefined
      )
        return { ok: false, error: 'invalid' }
      if (assignee !== null && (!STAFF_ID.test(assignee) || !staffIds.has(assignee)))
        return { ok: false, error: 'unknown_staff' }
      const at = now()
      const done = await store.assign({
        id,
        expected,
        assignee,
        at,
        audit: {
          id: randomUUID(),
          actor: auditActor(actor),
          action: 'cms.lead.assign',
          entity: 'leads_requests',
          entityId: id,
          reason: `${expected ?? '—'} → ${assignee ?? '—'}`,
          result: 'ok',
          correlationId: actor.correlationId ?? null,
          at,
        },
      })
      if (done) return { ok: true, assignee }
      const current = await whyNot(id)
      return current
        ? { ok: false, error: 'conflict', assignee: current.assignee }
        : { ok: false, error: 'not_found' }
    },
  }
}

export type LeadBoardService = ReturnType<typeof createLeadBoardService>
