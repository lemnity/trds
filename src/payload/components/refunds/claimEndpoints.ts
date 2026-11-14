import type { Endpoint } from 'payload'

import type { ClaimError, ClaimService, StaffClaimView } from '@/modules/refund-claims/service'
import { CLAIM_BASIS_TEXT, type ClaimBasis } from '@/modules/refunds/claims-policy'

import type { StaffUser } from '../../access/roles'
import { writeCmsAudit, type CmsAuditWriter } from '../../audit'
import { json, readBody, roleGuard, routeParam } from '../../endpoints/http'
import { REFUNDS_ROLES } from './endpoints'

/**
 * REST заявок на возврат в админке: /api/cms/refund-claims…
 *
 * - очередь открытых заявок и последние решённые;
 * - одобрить с процентом номинала (подсказка — что положено по закону) — создаётся возврат через банк;
 * - отказать с объяснением для зрителя;
 * - открыть документ заявки (медицинские данные: только кассир/администратор с MFA, каждое
 *   открытие — в журнал).
 */

type Deps = {
  claims: () => Promise<ClaimService>
  audit: CmsAuditWriter
}

const defaultDeps: Deps = {
  // Динамический импорт: модуль подтягивает конфигурацию Payload (цикл с payload.config).
  claims: async () => (await import('@/modules/refund-claims')).getRefundClaims(),
  audit: writeCmsAudit,
}

const ENTITY = 'commerce_refund_claims'
const UUID = /^[0-9a-f-]{36}$/

const staffActor = (staff: StaffUser) => ({
  kind: 'staff' as const,
  staffId: String(staff.id),
  email: staff.email ?? null,
  role: staff.role ?? (staff.systemAdmin ? 'system' : 'unknown'),
})

const ERRORS: Partial<Record<ClaimError, [number, string]>> = {
  NOT_FOUND: [404, 'Заявка не найдена.'],
  CLOSED: [409, 'Заявка уже рассмотрена или отозвана зрителем.'],
  INVALID_PERCENT: [400, 'Процент возврата — целое число от 1 до 100.'],
  DECISION_COMMENT: [400, 'Напишите объяснение для зрителя (от 3 символов).'],
}

const REFUND_ERRORS: Record<string, string> = {
  NOT_REFUNDABLE: 'Билеты уже возвращены или недействительны — откажите с объяснением.',
  IN_PROGRESS: 'По этим билетам уже идёт возврат.',
  PAYMENT_UNAVAILABLE: 'Банк не подключён или платёж заказа неизвестен.',
  NOTHING_TO_REFUND: 'В заявке нет действующих билетов.',
}

const fail = (error: ClaimError, refundError?: string) => {
  if (error === 'REFUND_FAILED')
    return json(
      {
        error: 'refund_failed',
        message: REFUND_ERRORS[refundError ?? ''] ?? `Возврат не оформлен (${refundError}).`,
      },
      409,
    )
  const [status, message] = ERRORS[error] ?? [409, 'Действие недоступно.']
  return json({ error: error.toLowerCase(), message }, status)
}

const view = (c: StaffClaimView) => ({
  ...c,
  basisText: CLAIM_BASIS_TEXT[c.basis as ClaimBasis] ?? c.basis,
  startsAt: c.startsAt.toISOString(),
  documentDeadline: c.documentDeadline?.toISOString() ?? null,
  filesUntil: c.filesUntil.toISOString(),
  decidedAt: c.decidedAt?.toISOString() ?? null,
  createdAt: c.createdAt.toISOString(),
  files: c.files.map((f) => ({ ...f, uploadedAt: f.uploadedAt.toISOString() })),
})

export function refundClaimEndpoints(overrides: Partial<Deps> = {}): Endpoint[] {
  const { claims, audit } = { ...defaultDeps, ...overrides }
  const guard = (method: Endpoint['method'], action: string) =>
    roleGuard({ method, roles: REFUNDS_ROLES, action, entity: ENTITY, audit })

  return [
    {
      path: '/cms/refund-claims',
      method: 'get',
      handler: guard(
        'get',
        'cms.refund_claim.list',
      )(async () => {
        const { open, closed } = await (await claims()).listForStaff()
        return json({ open: open.map(view), closed: closed.map(view) })
      }),
    },
    {
      path: '/cms/refund-claims/:id/approve',
      method: 'post',
      handler: guard(
        'post',
        'cms.refund_claim.approve',
      )(async (req, staff) => {
        const id = routeParam(req, 'id')
        if (!UUID.test(id)) return json({ error: 'invalid' }, 400)
        const body = await readBody(req)
        const result = await (
          await claims()
        ).approve({
          staff: staffActor(staff),
          claimId: id,
          percent: Number(body.percent),
          includeFee: body.includeFee === true,
          comment: typeof body.comment === 'string' ? body.comment : null,
        })
        await audit(req, {
          action: 'cms.refund_claim.approve',
          entity: ENTITY,
          entityId: id,
          result: result.ok ? 'ok' : 'denied',
          reason: result.ok ? `${result.value.decidedPercent}%` : result.error,
        })
        if (!result.ok) return fail(result.error, result.refundError)
        return json({ claim: view(result.value) })
      }),
    },
    {
      path: '/cms/refund-claims/:id/reject',
      method: 'post',
      handler: guard(
        'post',
        'cms.refund_claim.reject',
      )(async (req, staff) => {
        const id = routeParam(req, 'id')
        if (!UUID.test(id)) return json({ error: 'invalid' }, 400)
        const body = await readBody(req)
        const result = await (
          await claims()
        ).reject({
          staff: staffActor(staff),
          claimId: id,
          comment: typeof body.comment === 'string' ? body.comment : '',
        })
        await audit(req, {
          action: 'cms.refund_claim.reject',
          entity: ENTITY,
          entityId: id,
          result: result.ok ? 'ok' : 'denied',
        })
        if (!result.ok) return fail(result.error)
        return json({ claim: view(result.value) })
      }),
    },
    {
      path: '/cms/refund-claims/files/:id',
      method: 'get',
      handler: guard(
        'get',
        'cms.refund_claim.file',
      )(async (req) => {
        const id = routeParam(req, 'id')
        if (!UUID.test(id)) return json({ error: 'invalid' }, 400)
        const found = await (await claims()).fileForStaff(id)
        if (!found) return json({ error: 'not_found' }, 404)
        // Медицинские персональные данные: кто и когда открывал — в журнале.
        await audit(req, {
          action: 'cms.refund_claim.file_view',
          entity: ENTITY,
          entityId: found.file.claimId,
          result: 'ok',
        })
        const ext = found.file.mimeType === 'application/pdf' ? 'pdf' : 'img'
        return new Response(new Uint8Array(found.bytes), {
          headers: {
            'Content-Type': found.file.mimeType,
            'Content-Disposition': `inline; filename="document-${id.slice(0, 8)}.${ext}"`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      }),
    },
  ]
}
