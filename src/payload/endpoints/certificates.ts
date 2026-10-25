import type { Endpoint, PayloadRequest } from 'payload'

import { createLogger } from '@/lib/log'
import {
  listCertificates,
  type CertificateListItem,
  type CertificateListStatus,
} from '@/modules/wallet/admin'
import type { WalletService } from '@/modules/wallet/service'

import type { StaffRole } from '../access/roles'
import { writeCmsAudit, type CmsAuditWriter } from '../audit'
import { json, readBody, roleGuard, routeParam } from './http'

/**
 * REST подарочных сертификатов в админке (T-066): /api/cms/certificates…
 *
 * - список — порядковый номер, последние 4 символа, номинал, статус, срок, когда активирован;
 *   из данных покупателя — только id;
 * - выпуск партии — как `pnpm certificates:issue` (src/bin/issue-certificates.ts): полные номера
 *   есть только в этом ответе (в базе — хеш и последние 4), ответ не кешируется, в журнал
 *   и логи номера не попадают;
 * - аннулирование — только выпущенного и ещё не активированного, причина обязательна.
 *
 * Только администратор театра с пройденной MFA; каждое действие — в журнале аудита.
 */

export const CERTIFICATES_ROLES: readonly StaffRole[] = ['admin']
export const MAX_NOMINAL_RUB = 1_000_000
export const MAX_CERTIFICATES_PER_REQUEST = 500

const STATUSES: readonly CertificateListStatus[] = ['issued', 'activated', 'expired', 'annulled']

type Wallet = Pick<WalletService, 'issueCertificates' | 'annulCertificate'>

export type CertificateEndpointDeps = {
  wallet: () => Promise<Wallet>
  list: (
    req: PayloadRequest,
    opts: { status: CertificateListStatus | null; page: number },
  ) => Promise<{ items: CertificateListItem[]; total: number; page: number; pageSize: number }>
  audit: CmsAuditWriter
  now: () => Date
}

const log = createLogger({ base: { service: 'cms' } })

const defaultDeps: CertificateEndpointDeps = {
  // Динамический импорт: модуль кошелька подтягивает конфигурацию Payload (цикл с payload.config).
  wallet: async () => (await import('@/modules/wallet')).getWallet(),
  list: (req, opts) =>
    listCertificates(
      req.payload.db.drizzle as unknown as Parameters<typeof listCertificates>[0],
      opts,
    ),
  audit: writeCmsAudit,
  now: () => new Date(),
}

const ENTITY = 'wallet_certificates'

/** «до 31.12.2027 включительно» — конец дня по Москве, как в CLI выпуска. */
export const endOfMoscowDay = (iso: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const d = new Date(`${iso}T23:59:59.999+03:00`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : d
}

const positiveInt = (v: unknown, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN
  return Number.isSafeInteger(n) && n >= 1 && n <= max ? n : null
}

export function certificateEndpoints(overrides: Partial<CertificateEndpointDeps> = {}): Endpoint[] {
  const { wallet, list, audit, now } = { ...defaultDeps, ...overrides }
  const guard = (method: Endpoint['method'], action: string) =>
    roleGuard({ method, roles: CERTIFICATES_ROLES, action, entity: ENTITY, audit })

  return [
    {
      path: '/cms/certificates',
      method: 'get',
      handler: guard(
        'get',
        'cms.certificate.list',
      )(async (req) => {
        const q = req.searchParams
        const raw = q?.get('status') ?? ''
        const status = (STATUSES as readonly string[]).includes(raw)
          ? (raw as CertificateListStatus)
          : null
        const page = positiveInt(q?.get('page') ?? '1', 10_000) ?? 1
        return json(await list(req, { status, page }))
      }),
    },
    {
      path: '/cms/certificates/issue',
      method: 'post',
      handler: guard(
        'post',
        'cms.certificate.issue',
      )(async (req, staff) => {
        const body = await readBody(req)
        const amountRub = positiveInt(body.amountRub, MAX_NOMINAL_RUB)
        const count = positiveInt(body.count, MAX_CERTIFICATES_PER_REQUEST)
        const rawValidUntil = typeof body.validUntil === 'string' ? body.validUntil.trim() : ''
        const validUntil = rawValidUntil ? endOfMoscowDay(rawValidUntil) : null
        const comment =
          typeof body.comment === 'string' ? body.comment.trim().slice(0, 500) || null : null
        const fields: Record<string, string> = {}
        if (!amountRub) fields.amountRub = `Номинал — целое число рублей от 1 до ${MAX_NOMINAL_RUB}`
        if (!count) fields.count = `Количество — от 1 до ${MAX_CERTIFICATES_PER_REQUEST}`
        if (rawValidUntil && (!validUntil || validUntil <= now()))
          fields.validUntil = 'Срок — дата в будущем'
        if (Object.keys(fields).length) return json({ error: 'invalid', fields }, 400)

        const issued = await (
          await wallet()
        ).issueCertificates(
          {
            amountKopecks: amountRub! * 100,
            count: count!,
            validUntil,
            comment,
            issuedBy: `admin-users:${staff.id}`,
          },
          now(),
        )
        const serials = issued.map((c) => c.serial)
        // Журнал — после выпуска (у кошелька своя транзакция). Сбой журнала не должен «съесть»
        // уже выпущенные номера: они показываются один раз — отдаём их и сигналим в лог.
        try {
          await audit(req, {
            action: 'cms.certificate.issue',
            entity: ENTITY,
            entityId: `${serials[0]}..${serials[serials.length - 1]}`,
            result: 'ok',
            reason: `count: ${issued.length}; amount: ${amountRub} RUB; valid until: ${rawValidUntil || '—'}`,
          })
        } catch (error) {
          log.error('cms.certificate.issue_audit_failed', {
            error: error instanceof Error ? error.name : 'unknown',
            first: serials[0],
            count: issued.length,
          })
        }
        return json({
          certificates: issued,
          amountRub,
          validUntil: rawValidUntil || null,
        })
      }),
    },
    {
      path: '/cms/certificates/:id/annul',
      method: 'post',
      handler: guard(
        'post',
        'cms.certificate.annul',
      )(async (req) => {
        const serial = positiveInt(routeParam(req, 'id'), 2_147_483_647)
        const body = await readBody(req)
        const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
        if (!serial) return json({ error: 'invalid' }, 400)
        if (reason.length < 3)
          return json({ error: 'reason_required', fields: { reason: 'Укажите причину' } }, 400)
        const ok = await (await wallet()).annulCertificate(serial)
        await audit(req, {
          action: 'cms.certificate.annul',
          entity: ENTITY,
          entityId: String(serial),
          result: ok ? 'ok' : 'failed',
          reason,
        })
        // Не найден, уже активирован или уже аннулирован — состояние не меняется.
        return ok ? json({ ok: true, serial }) : json({ error: 'not_annullable' }, 409)
      }),
    },
  ]
}
