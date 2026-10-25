import type { Endpoint } from 'payload'

import type { RefundService, RefundSummary } from '@/modules/refunds/service'

import type { StaffRole, StaffUser } from '../../access/roles'
import { writeCmsAudit, type CmsAuditWriter } from '../../audit'
import { correlationOf, json, readBody, roleGuard, routeParam } from '../../endpoints/http'

/**
 * REST возвратов в админке (T-053): /api/cms/refunds…
 *
 * - список последних возвратов, политика возвратов (заглушки до решения театра);
 * - поиск заказа по номеру TRD-XXXXXXXX: билеты, их доли денег/бонусов/сбора, прошлые возвраты;
 * - возврат полный (все действующие билеты) или частичный (выбранные), причина обязательна;
 * - повтор запроса в банк по зависшему возврату (тот же ключ банка — второй раз деньги не уйдут);
 * - изменение политики — только администратор театра.
 *
 * Кассир и администратор с пройденной MFA. Денежные действия журналирует доменный слой
 * (`commerce_audit_log`: сотрудник, причина, ответ банка); отказ по роли — `roleGuard`.
 */

export const REFUNDS_ROLES: readonly StaffRole[] = ['admin', 'cashier']
export const REFUND_POLICY_ROLES: readonly StaffRole[] = ['admin']

type Deps = {
  refunds: () => Promise<RefundService>
  audit: CmsAuditWriter
}

const defaultDeps: Deps = {
  // Динамический импорт: модуль возвратов подтягивает конфигурацию Payload (цикл с payload.config).
  refunds: async () => (await import('@/modules/refunds')).getRefunds(),
  audit: writeCmsAudit,
}

const ENTITY = 'commerce_refunds'
const ORDER = /^TRD-[A-Z0-9]{8}$/
const TICKET = /^TRD-[A-Z0-9]{8}-\d{2}$/
const KEY = /^[A-Za-z0-9-]{16,100}$/

const staffActor = (staff: StaffUser) => ({
  kind: 'staff' as const,
  staffId: String(staff.id),
  role: staff.role ?? (staff.systemAdmin ? 'system' : 'unknown'),
})

const ERRORS: Record<string, [number, string]> = {
  NOT_FOUND: [404, 'Заказ или билет не найден.'],
  INVALID_KEY: [400, 'Обновите страницу и повторите.'],
  INVALID_REASON: [400, 'Укажите причину (от 3 до 500 символов).'],
  IN_PROGRESS: [409, 'По этим билетам уже идёт возврат.'],
  NOT_REFUNDABLE: [409, 'Эти билеты вернуть нельзя (статус заказа или билета).'],
  NOTHING_TO_REFUND: [409, 'В заказе нет действующих билетов.'],
  IDEMPOTENCY_CONFLICT: [409, 'Обновите страницу и повторите.'],
  PAYMENT_UNAVAILABLE: [503, 'Банк не подключён или платёж заказа неизвестен.'],
}

const view = (r: RefundSummary) => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  completedAt: r.completedAt?.toISOString() ?? null,
  bonusSettledAt: r.bonusSettledAt?.toISOString() ?? null,
})

export function refundEndpoints(overrides: Partial<Deps> = {}): Endpoint[] {
  const { refunds, audit } = { ...defaultDeps, ...overrides }
  const guard = (method: Endpoint['method'], action: string, roles = REFUNDS_ROLES) =>
    roleGuard({ method, roles, action, entity: ENTITY, audit })

  return [
    {
      path: '/cms/refunds',
      method: 'get',
      handler: guard(
        'get',
        'cms.refund.list',
      )(async () => {
        const service = await refunds()
        const [policy, recent] = await Promise.all([service.policy(), service.recent()])
        return json({ available: service.available, policy, recent: recent.map(view) })
      }),
    },
    {
      path: '/cms/refunds/order/:number',
      method: 'get',
      handler: guard(
        'get',
        'cms.refund.order',
      )(async (req) => {
        const number = routeParam(req, 'number').trim().toUpperCase()
        if (!ORDER.test(number)) return json({ error: 'invalid' }, 400)
        const found = await (await refunds()).orderForStaff(number)
        if (!found) return json({ error: 'not_found' }, 404)
        return json({
          ...found,
          order: { ...found.order, paidAt: found.order.paidAt?.toISOString() ?? null },
          refunds: found.refunds.map(view),
        })
      }),
    },
    {
      path: '/cms/refunds',
      method: 'post',
      handler: guard(
        'post',
        'cms.refund.request',
      )(async (req, staff) => {
        const body = await readBody(req)
        const orderNumber = typeof body.orderNumber === 'string' ? body.orderNumber.trim() : ''
        const tickets = Array.isArray(body.tickets) ? body.tickets : []
        const reason = typeof body.reason === 'string' ? body.reason : ''
        const clientKey = typeof body.clientKey === 'string' ? body.clientKey : ''
        if (
          !ORDER.test(orderNumber.toUpperCase()) ||
          tickets.length > 20 ||
          !tickets.every((t): t is string => typeof t === 'string' && TICKET.test(t)) ||
          !KEY.test(clientKey)
        )
          return json({ error: 'invalid' }, 400)
        if (reason.trim().length < 3)
          return json({ error: 'reason_required', fields: { reason: 'Укажите причину' } }, 400)
        const result = await (
          await refunds()
        ).requestStaffRefund({
          staff: staffActor(staff),
          orderNumber,
          ticketNumbers: tickets,
          reason,
          includeFee: body.includeFee === true,
          clientKey,
          correlationId: correlationOf(req),
        })
        if (result.ok) return json({ duplicate: result.duplicate, refund: view(result.refund) })
        const [status, message] = ERRORS[result.error] ?? [409, 'Возврат не оформлен.']
        return json(
          {
            error: result.error.toLowerCase(),
            message,
            ...(result.refund && { refund: view(result.refund) }),
          },
          status,
        )
      }),
    },
    {
      path: '/cms/refunds/:id/retry',
      method: 'post',
      handler: guard(
        'post',
        'cms.refund.retry',
      )(async (req, staff) => {
        const id = routeParam(req, 'id')
        if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'invalid' }, 400)
        const body = await readBody(req)
        const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
        if (reason.length < 3)
          return json({ error: 'reason_required', fields: { reason: 'Укажите причину' } }, 400)
        const done = await (await refunds()).retryRefund(id, staffActor(staff), reason)
        return done ? json({ refund: view(done) }) : json({ error: 'not_retryable' }, 409)
      }),
    },
    {
      path: '/cms/refunds/policy',
      method: 'post',
      handler: guard(
        'post',
        'cms.refund.policy',
        REFUND_POLICY_ROLES,
      )(async (req, staff) => {
        const body = await readBody(req)
        const result = await (await refunds()).updatePolicy(body.policy, staffActor(staff))
        return result.ok ? json({ policy: result.policy }) : json({ error: 'invalid' }, 400)
      }),
    },
  ]
}
