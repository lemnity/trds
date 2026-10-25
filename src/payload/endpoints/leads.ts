import type { Endpoint, PayloadRequest } from 'payload'

import {
  CLIENT_STATUS_EMAIL_ENABLED,
  LEAD_TRANSITIONS,
  createLeadBoardService,
  type LeadBoardService,
} from '@/modules/lead-requests/board'
import { pgLeadStore } from '@/modules/lead-requests/pgStore'

import { ADMIN_USERS_SLUG, type StaffRole, type StaffUser } from '../access/roles'
import { writeCmsAudit, type CmsAuditWriter } from '../audit'
import { correlationOf, json, readBody, roleGuard, routeParam } from './http'

/**
 * REST канбана корпоративов (T-065): /api/cms/leads… Только администратор театра с пройденной MFA
 * (plan-main.md §7.1: канбан — раздел администратора; кассир и редактор заявок не видят). Список —
 * карточки без контактов; контакты — только в подробностях одной заявки. Смена статуса и
 * ответственного — use-case `@/modules/lead-requests/board` (условный переход, история и аудит
 * одной транзакцией).
 */

export const LEADS_ROLES: readonly StaffRole[] = ['admin']

export type StaffOption = { id: string; label: string }

export type LeadEndpointDeps = {
  board: (req: PayloadRequest) => LeadBoardService
  staff: (req: PayloadRequest) => Promise<StaffOption[]>
  audit: CmsAuditWriter
}

const defaultDeps: LeadEndpointDeps = {
  board: (req) =>
    createLeadBoardService({
      store: pgLeadStore(req.payload.db.drizzle as unknown as Parameters<typeof pgLeadStore>[0]),
    }),
  // Сотрудники для выбора ответственного: имя или почта (данные сотрудников, не клиентов).
  staff: async (req) => {
    const { docs } = await req.payload.find({
      collection: ADMIN_USERS_SLUG,
      depth: 0,
      limit: 200,
      pagination: false,
      overrideAccess: true,
      req,
    })
    return (docs as (StaffUser & { name?: string | null })[]).map((u) => ({
      id: String(u.id),
      label: u.name?.trim() || u.email || `#${u.id}`,
    }))
  },
  audit: writeCmsAudit,
}

const MOVE_STATUS = {
  invalid: 400,
  invalid_transition: 422,
  client_email_disabled: 422,
  not_found: 404,
  conflict: 409,
  unknown_staff: 422,
} as const

export function leadEndpoints(overrides: Partial<LeadEndpointDeps> = {}): Endpoint[] {
  const { board, staff, audit } = { ...defaultDeps, ...overrides }
  const guard = (method: Endpoint['method'], action: string) =>
    roleGuard({ method, roles: LEADS_ROLES, action, entity: 'leads_requests', audit })
  const actorOf = (req: PayloadRequest, user: StaffUser) => ({
    staffId: String(user.id),
    correlationId: correlationOf(req),
  })

  return [
    {
      path: '/cms/leads',
      method: 'get',
      handler: guard(
        'get',
        'cms.lead.list',
      )(async (req) => {
        const [cards, people] = await Promise.all([board(req).board(), staff(req)])
        // Переходы — с сервера: экран не держит свою копию правил.
        return json({
          cards,
          staff: people,
          transitions: LEAD_TRANSITIONS,
          clientEmailEnabled: CLIENT_STATUS_EMAIL_ENABLED,
        })
      }),
    },
    {
      path: '/cms/leads/:id',
      method: 'get',
      handler: guard(
        'get',
        'cms.lead.read',
      )(async (req) => {
        const lead = await board(req).detail(routeParam(req, 'id'))
        return lead ? json({ lead }) : json({ error: 'not_found' }, 404)
      }),
    },
    {
      path: '/cms/leads/:id/move',
      method: 'post',
      handler: guard(
        'post',
        'cms.lead.move',
      )(async (req, user) => {
        const body = await readBody(req)
        const result = await board(req).move(
          {
            id: routeParam(req, 'id'),
            from: body.from,
            to: body.to,
            notifyClient: body.notifyClient,
          },
          actorOf(req, user),
        )
        if (result.ok) return json(result)
        return json(result, MOVE_STATUS[result.error])
      }),
    },
    {
      path: '/cms/leads/:id/assign',
      method: 'post',
      handler: guard(
        'post',
        'cms.lead.assign',
      )(async (req, user) => {
        const body = await readBody(req)
        const ids = new Set((await staff(req)).map((s) => s.id))
        const result = await board(req).assign(
          { id: routeParam(req, 'id'), expected: body.expected, assignee: body.assignee },
          actorOf(req, user),
          ids,
        )
        if (result.ok) return json(result)
        return json(result, MOVE_STATUS[result.error])
      }),
    },
  ]
}
