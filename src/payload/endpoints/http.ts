import type { Endpoint, PayloadRequest } from 'payload'

import { correlationIdFrom } from '@/lib/correlation'

import {
  ADMIN_USERS_SLUG,
  activeStaff,
  hasRole,
  type StaffRole,
  type StaffUser,
} from '../access/roles'
import type { CmsAuditWriter } from '../audit'

/**
 * Общие части REST админки (канбан, сертификаты): ответы без кеша, проверка origin, разбор тела
 * и охрана по роли. Права решает сервер (rules.md §4): роль и пройденная MFA — `activeStaff`.
 */

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

/** Изменяющие запросы с cookie — только со своего origin (CSRF). */
export const sameOrigin = (req: PayloadRequest) => {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).host === req.headers.get('host')
  } catch {
    return false
  }
}

export const readBody = async (req: PayloadRequest): Promise<Record<string, unknown>> => {
  try {
    const body = (await req.json?.()) as unknown
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export const correlationOf = (req: PayloadRequest) =>
  req.headers ? correlationIdFrom(req.headers) : null

export const routeParam = (req: PayloadRequest, name: string) => {
  const v = (req.routeParams as Record<string, unknown> | undefined)?.[name]
  return typeof v === 'string' ? v : ''
}

type Handler = (req: PayloadRequest, staff: StaffUser) => Promise<Response>

/**
 * Обёртка обработчика: сотрудник с действующими правами нужной роли; POST — со своего origin.
 * Отказ изменяющего запроса пишется в журнал (`result: denied`) — попытки видны администратору.
 */
export const roleGuard =
  ({
    method,
    roles,
    action,
    entity,
    audit,
  }: {
    method: Endpoint['method']
    roles: readonly StaffRole[]
    action: string
    entity: string
    audit: CmsAuditWriter
  }) =>
  (fn: Handler): Endpoint['handler'] =>
  async (req) => {
    const user = req.user as StaffUser | null | undefined
    if (!user || user.collection !== ADMIN_USERS_SLUG) return json({ error: 'unauthorized' }, 401)
    const mutating = method !== 'get'
    if (mutating && !sameOrigin(req)) return json({ error: 'forbidden' }, 403)
    const staff = activeStaff(req)
    if (!staff || !hasRole(req, roles)) {
      if (mutating)
        await audit(req, {
          action,
          entity,
          entityId: routeParam(req, 'id') || '-',
          result: 'denied',
        })
      return json({ error: staff ? 'forbidden' : 'mfa_required' }, 403)
    }
    return fn(req, staff)
  }
