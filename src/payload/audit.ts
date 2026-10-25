import { randomUUID } from 'node:crypto'

import type { PayloadRequest } from 'payload'

import { commerceAuditLog } from '@/db/schema/commerce'
import { correlationIdFrom } from '@/lib/correlation'

import { transactionDb } from './db'

/**
 * Журнал административных действий CMS (ADMIN-02, T-023): кто, когда, что, причина, результат.
 * Пишется в общую таблицу `commerce_audit_log` в той же транзакции Payload, что и само изменение:
 * откат правки откатывает и запись журнала. Без email и секретов — только id сотрудника.
 */
export type CmsAuditEntry = {
  action: string
  entity: string
  entityId: string
  result: 'ok' | 'denied' | 'failed'
  reason?: string | null
}

export type CmsAuditWriter = (req: PayloadRequest, entry: CmsAuditEntry) => Promise<void>

type DrizzleInsert = {
  insert: (table: typeof commerceAuditLog) => {
    values: (row: typeof commerceAuditLog.$inferInsert) => Promise<unknown>
  }
}

export const actorOf = (req: PayloadRequest) => {
  const user = req.user as { id?: number | string; collection?: string } | null | undefined
  return user?.id !== undefined ? `${user.collection ?? 'user'}:${user.id}` : 'system'
}

export const writeCmsAudit: CmsAuditWriter = async (req, entry) => {
  const db = await transactionDb<DrizzleInsert>(req)
  await db.insert(commerceAuditLog).values({
    id: randomUUID(),
    actor: actorOf(req),
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    reason: entry.reason ?? null,
    result: entry.result,
    correlationId: req.headers ? correlationIdFrom(req.headers) : null,
    at: new Date(),
  })
}
