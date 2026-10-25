import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from '@payloadcms/db-postgres/drizzle'
import type { NodePgDatabase } from '@payloadcms/db-postgres/drizzle/node-postgres'

import {
  walletCertificates,
  walletLedger,
  walletReferralCodes,
  walletReferrals,
  walletSpendAllocations,
} from '@/db/schema/wallet'

import type { CertificateRow, LedgerEntry, WalletStore, WalletTx } from './service'

type Db = NodePgDatabase<Record<string, never>>

const liveLot = (customerId: string, now: Date) =>
  and(
    eq(walletLedger.customerId, customerId),
    gt(walletLedger.amountKopecks, 0),
    gt(walletLedger.lotRemainingKopecks, 0),
    gt(walletLedger.expiresAt, now),
  )

const lotColumns = {
  id: walletLedger.id,
  remainingKopecks: sql<number>`${walletLedger.lotRemainingKopecks}`.mapWith(Number),
  expiresAt: sql<Date>`${walletLedger.expiresAt}`.mapWith(walletLedger.expiresAt),
}

/** Операции одной транзакции (READ COMMITTED + явные блокировки строк). */
function pgTx(db: Db): WalletTx {
  return {
    async insertEntry(entry) {
      // Повтор того же события — ON CONFLICT по ключу идемпотентности, без ошибки и без второй строки.
      const rows = await db
        .insert(walletLedger)
        .values(entry)
        .onConflictDoNothing({ target: walletLedger.idempotencyKey })
        .returning({ id: walletLedger.id })
      return rows.length === 1
    },
    async findEntryByKey(key) {
      const [row] = await db.select().from(walletLedger).where(eq(walletLedger.idempotencyKey, key))
      return (row as LedgerEntry | undefined) ?? null
    },
    async lockLiveLots(customerId, now) {
      // Детерминированный порядок блокировки (по id) — параллельные списания не взаимоблокируются.
      return db
        .select(lotColumns)
        .from(walletLedger)
        .where(liveLot(customerId, now))
        .orderBy(asc(walletLedger.id))
        .for('update')
    },
    async takeFromLot(lotId, kopecks) {
      const rows = await db
        .update(walletLedger)
        .set({ lotRemainingKopecks: sql`${walletLedger.lotRemainingKopecks} - ${kopecks}` })
        .where(and(eq(walletLedger.id, lotId), gte(walletLedger.lotRemainingKopecks, kopecks)))
        .returning({ id: walletLedger.id })
      return rows.length === 1
    },
    async insertAllocations(rows) {
      if (rows.length) await db.insert(walletSpendAllocations).values(rows)
    },
    async spendAllocations(spendEntryId) {
      const rows = await db
        .select({
          lotEntryId: walletSpendAllocations.lotEntryId,
          kopecks: sql<number>`${walletSpendAllocations.kopecks}`.mapWith(Number),
          expiresAt: walletLedger.expiresAt,
        })
        .from(walletSpendAllocations)
        .innerJoin(walletLedger, eq(walletLedger.id, walletSpendAllocations.lotEntryId))
        .where(eq(walletSpendAllocations.spendEntryId, spendEntryId))
        .orderBy(asc(walletSpendAllocations.lotEntryId))
      return rows.map((r) => ({ ...r, expiresAt: r.expiresAt! }))
    },
    async lockExpiredLots(now, limit) {
      return db
        .select({
          id: walletLedger.id,
          customerId: walletLedger.customerId,
          remainingKopecks: sql<number>`${walletLedger.lotRemainingKopecks}`.mapWith(Number),
        })
        .from(walletLedger)
        .where(
          and(
            gt(walletLedger.amountKopecks, 0),
            gt(walletLedger.lotRemainingKopecks, 0),
            lte(walletLedger.expiresAt, now),
          ),
        )
        .orderBy(asc(walletLedger.id))
        .limit(limit)
        .for('update', { skipLocked: true })
    },
    async zeroLot(lotId, expected) {
      const rows = await db
        .update(walletLedger)
        .set({ lotRemainingKopecks: 0 })
        .where(and(eq(walletLedger.id, lotId), eq(walletLedger.lotRemainingKopecks, expected)))
        .returning({ id: walletLedger.id })
      return rows.length === 1
    },
    async activateCertificate(codeHash, customerId, now) {
      // Один условный переход: параллельная активация того же номера ждёт блокировку строки,
      // затем перепроверяет WHERE и ничего не находит.
      const [row] = await db
        .update(walletCertificates)
        .set({ status: 'activated', activatedByCustomer: customerId, activatedAt: now })
        .where(
          and(
            eq(walletCertificates.codeHash, codeHash),
            eq(walletCertificates.status, 'issued'),
            or(isNull(walletCertificates.validUntil), gt(walletCertificates.validUntil, now)),
          ),
        )
        .returning()
      return (row as CertificateRow | undefined) ?? null
    },
    async insertCertificate(row) {
      const [inserted] = await db
        .insert(walletCertificates)
        .values(row)
        .onConflictDoNothing({ target: walletCertificates.codeHash })
        .returning({ serial: walletCertificates.serial })
      return inserted?.serial ?? null
    },
    async annulCertificate(serial) {
      const rows = await db
        .update(walletCertificates)
        .set({ status: 'annulled' })
        .where(and(eq(walletCertificates.serial, serial), eq(walletCertificates.status, 'issued')))
        .returning({ id: walletCertificates.id })
      return rows.length === 1
    },
    async lockReferrer(referrerId) {
      await db
        .select({ id: walletReferralCodes.customerId })
        .from(walletReferralCodes)
        .where(eq(walletReferralCodes.customerId, referrerId))
        .for('update')
    },
    async findReferral(referredCustomerId) {
      const [row] = await db
        .select()
        .from(walletReferrals)
        .where(eq(walletReferrals.referredCustomerId, referredCustomerId))
      return row ?? null
    },
    async markQualified(referredCustomerId, at) {
      const rows = await db
        .update(walletReferrals)
        .set({ qualifiedAt: at })
        .where(
          and(
            eq(walletReferrals.referredCustomerId, referredCustomerId),
            isNull(walletReferrals.qualifiedAt),
          ),
        )
        .returning({ id: walletReferrals.id })
      return rows.length === 1
    },
    async countQualified(referrerId) {
      const [row] = await db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(walletReferrals)
        .where(
          and(
            eq(walletReferrals.referrerId, referrerId),
            sql`${walletReferrals.qualifiedAt} IS NOT NULL`,
          ),
        )
      return row?.n ?? 0
    },
    async unmarkQualified(referredCustomerId) {
      const rows = await db
        .update(walletReferrals)
        .set({ qualifiedAt: null })
        .where(
          and(
            eq(walletReferrals.referredCustomerId, referredCustomerId),
            isNotNull(walletReferrals.qualifiedAt),
            isNull(walletReferrals.rewardEntryId),
          ),
        )
        .returning({ id: walletReferrals.id })
      return rows.length === 1
    },
    async setGroupReward(referrerId, entryId) {
      await db
        .update(walletReferrals)
        .set({ rewardEntryId: entryId })
        .where(
          and(
            eq(walletReferrals.referrerId, referrerId),
            isNotNull(walletReferrals.qualifiedAt),
            isNull(walletReferrals.rewardEntryId),
          ),
        )
    },
    async lockCustomer(customerId) {
      // Блокировка до конца транзакции; ключ — хеш метки и id покупателя (не пересекается с чужими).
      await db.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${customerId}`}, 0))`,
      )
    },
    openDebts: (customerId) => openDebts(db, customerId),
    async entriesBySource(customerId, kind, sourceRef) {
      const rows = await db
        .select()
        .from(walletLedger)
        .where(
          and(
            eq(walletLedger.customerId, customerId),
            eq(walletLedger.kind, kind),
            eq(walletLedger.sourceRef, sourceRef),
          ),
        )
        .orderBy(asc(walletLedger.createdAt), asc(walletLedger.id))
      return rows as LedgerEntry[]
    },
  }
}

/** Сторно с непокрытым остатком (долг): −сумма − погашено долями, старые первыми. */
async function openDebts(db: Db, customerId: string) {
  const rows = await db
    .select({
      entryId: walletLedger.id,
      // Имена таблиц явно: в подзапросе неквалифицированный "id" был бы id доли, а не строки.
      outstandingKopecks:
        sql<number>`(-"wallet_ledger"."amount_kopecks" - COALESCE((SELECT SUM(a."kopecks") FROM "wallet_spend_allocations" a WHERE a."spend_entry_id" = "wallet_ledger"."id"), 0))`.mapWith(
          Number,
        ),
    })
    .from(walletLedger)
    .where(and(eq(walletLedger.customerId, customerId), eq(walletLedger.kind, 'reversal')))
    .orderBy(asc(walletLedger.createdAt), asc(walletLedger.id))
  return rows.filter((r) => r.outstandingKopecks > 0)
}

/** Хранилище кошелька в PostgreSQL (таблицы src/db/schema/wallet.ts). */
export function pgWalletStore(db: Db): WalletStore {
  return {
    async transaction(fn) {
      // Ошибка внутри — ROLLBACK: ни перехода сертификата, ни строки журнала.
      return db.transaction((trx) => fn(pgTx(trx as unknown as Db)))
    },
    async liveLots(customerId, now) {
      return db.select(lotColumns).from(walletLedger).where(liveLot(customerId, now))
    },
    async history(customerId, limit) {
      const rows = await db
        .select()
        .from(walletLedger)
        .where(eq(walletLedger.customerId, customerId))
        .orderBy(desc(walletLedger.createdAt), desc(walletLedger.id))
        .limit(limit)
      return rows as LedgerEntry[]
    },
    async activatedCertificates(customerId) {
      const rows = await db
        .select({
          serial: walletCertificates.serial,
          last4: walletCertificates.last4,
          amountKopecks: walletCertificates.amountKopecks,
          activatedAt: walletCertificates.activatedAt,
          expiresAt: walletLedger.expiresAt,
        })
        .from(walletCertificates)
        .innerJoin(
          walletLedger,
          eq(walletLedger.idempotencyKey, sql`'certificate:' || ${walletCertificates.id}`),
        )
        .where(
          and(
            eq(walletCertificates.activatedByCustomer, customerId),
            eq(walletCertificates.status, 'activated'),
          ),
        )
        .orderBy(desc(walletCertificates.activatedAt))
      return rows.map((r) => ({ ...r, activatedAt: r.activatedAt!, expiresAt: r.expiresAt! }))
    },
    async referralCode(customerId) {
      const [row] = await db
        .select({ code: walletReferralCodes.code })
        .from(walletReferralCodes)
        .where(eq(walletReferralCodes.customerId, customerId))
      return row?.code ?? null
    },
    async insertReferralCode(customerId, code, at) {
      // Конфликт по покупателю (параллельный вызов) или по коду (совпадение) — ничего не делаем.
      await db
        .insert(walletReferralCodes)
        .values({ customerId, code, createdAt: at })
        .onConflictDoNothing()
    },
    async findReferrerByCode(code) {
      const [row] = await db
        .select({ customerId: walletReferralCodes.customerId })
        .from(walletReferralCodes)
        .where(eq(walletReferralCodes.code, code))
      return row?.customerId ?? null
    },
    async attachReferral(row) {
      const rows = await db
        .insert(walletReferrals)
        .values(row)
        .onConflictDoNothing({ target: walletReferrals.referredCustomerId })
        .returning({ id: walletReferrals.id })
      return rows.length === 1
    },
    async qualifiedCount(referrerId) {
      return pgTx(db).countQualified(referrerId)
    },
    async debt(customerId) {
      return (await openDebts(db, customerId)).reduce((n, d) => n + d.outstandingKopecks, 0)
    },
  }
}
