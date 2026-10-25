import {
  and,
  count,
  desc,
  eq,
  gte,
  isNull,
  lt,
  or,
  type SQL,
} from '@payloadcms/db-postgres/drizzle'
import type { NodePgDatabase } from '@payloadcms/db-postgres/drizzle/node-postgres'

import { walletCertificates } from '@/db/schema/wallet'

import type { CertificateStatus } from './service'

/**
 * Чтение сертификатов для админки (T-066, plan-main.md §7.2): только просмотр. Выпуск и
 * аннулирование — `issueCertificates` / `annulCertificate` сервиса кошелька. Хеш номера наружу не
 * отдаётся; из данных покупателя — только его id (кто активировал), без почты и имени.
 */

/** «Сгорел» — выпущен, но срок активации прошёл (в базе статус остаётся `issued`). */
export type CertificateListStatus = CertificateStatus | 'expired'

export type CertificateListItem = {
  serial: number
  last4: string
  amountKopecks: number
  status: CertificateListStatus
  validUntil: Date | null
  activatedAt: Date | null
  activatedByCustomer: string | null
  comment: string | null
  createdAt: Date
}

export const CERTIFICATES_PAGE_SIZE = 50

type Db = NodePgDatabase<Record<string, never>>

const filterOf = (status: CertificateListStatus | null, now: Date): SQL | undefined => {
  const c = walletCertificates
  const live = or(isNull(c.validUntil), gte(c.validUntil, now))
  switch (status) {
    case 'issued':
      return and(eq(c.status, 'issued'), live)
    case 'expired':
      return and(eq(c.status, 'issued'), lt(c.validUntil, now))
    case 'activated':
    case 'annulled':
      return eq(c.status, status)
    default:
      return undefined
  }
}

export async function listCertificates(
  db: Db,
  {
    status = null,
    page = 1,
    now = new Date(),
  }: { status?: CertificateListStatus | null; page?: number; now?: Date } = {},
): Promise<{ items: CertificateListItem[]; total: number; page: number; pageSize: number }> {
  const c = walletCertificates
  const where = filterOf(status, now)
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1
  const [rows, [totals]] = await Promise.all([
    db
      .select({
        serial: c.serial,
        last4: c.last4,
        amountKopecks: c.amountKopecks,
        status: c.status,
        validUntil: c.validUntil,
        activatedAt: c.activatedAt,
        activatedByCustomer: c.activatedByCustomer,
        comment: c.comment,
        createdAt: c.createdAt,
      })
      .from(c)
      .where(where)
      .orderBy(desc(c.serial))
      .limit(CERTIFICATES_PAGE_SIZE)
      .offset((safePage - 1) * CERTIFICATES_PAGE_SIZE),
    db.select({ n: count() }).from(c).where(where),
  ])
  return {
    items: rows.map((r) => ({
      ...r,
      status:
        r.status === 'issued' && r.validUntil !== null && r.validUntil < now ? 'expired' : r.status,
    })),
    total: Number(totals?.n ?? 0),
    page: safePage,
    pageSize: CERTIFICATES_PAGE_SIZE,
  }
}
