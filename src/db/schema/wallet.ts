import { sql } from '@payloadcms/db-postgres/drizzle'
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from '@payloadcms/db-postgres/drizzle/pg-core'

import { customers } from './accounts'

/**
 * Бонусный кошелёк зрителя (T-060…T-063, T-066, PRD §5.6, §5.8): журнал бонусов, подарочные
 * сертификаты, рефералы. Подключаются к схеме Payload через `beforeSchemaInit` (payload.config.ts),
 * как таблицы кабинета. Это не коллекции CMS: сотрудники не правят суммы руками (rules.md §2).
 */

const LEDGER_KINDS = ['purchase', 'referral', 'certificate', 'spend', 'expire', 'manual'] as const

/**
 * Журнал бонусов — только добавление. Положительная строка — «лот» начисления со своим сроком;
 * `lot_remaining_kopecks` — единственное изменяемое поле: его только уменьшают условным UPDATE
 * (списание, сгорание). Строки не удаляются и не правятся; коррекции — новыми строками.
 */
export const walletLedger = pgTable(
  'wallet_ledger',
  {
    id: uuid('id').primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: LEDGER_KINDS }).notNull(),
    /** Со знаком: начисление > 0, списание и сгорание < 0. */
    amountKopecks: bigint('amount_kopecks', { mode: 'number' }).notNull(),
    /** Остаток лота (только у начислений). */
    lotRemainingKopecks: bigint('lot_remaining_kopecks', { mode: 'number' }),
    /** Дата сгорания лота (только у начислений). */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Источник: номер заказа, id сертификата, id приглашённого, id лота. */
    sourceRef: text('source_ref'),
    /** Ключ идемпотентности операции: повтор события не создаёт вторую строку. */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    /** Исходная строка (лот для сгорания, операция для компенсации). */
    relatedEntryId: uuid('related_entry_id').references((): AnyPgColumn => walletLedger.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('wallet_ledger_customer_expires_idx').on(t.customerId, t.expiresAt),
    index('wallet_ledger_customer_created_idx').on(t.customerId, t.createdAt),
    check('wallet_ledger_amount_nonzero', sql`${t.amountKopecks} <> 0`),
    check(
      'wallet_ledger_lot_shape',
      sql`(${t.amountKopecks} > 0) = (${t.lotRemainingKopecks} IS NOT NULL AND ${t.expiresAt} IS NOT NULL)`,
    ),
    check(
      'wallet_ledger_lot_remaining',
      sql`${t.lotRemainingKopecks} IS NULL OR (${t.lotRemainingKopecks} >= 0 AND ${t.lotRemainingKopecks} <= ${t.amountKopecks})`,
    ),
  ],
)

/** Из каких лотов сделано списание — для возвратов (T-064). Только добавление. */
export const walletSpendAllocations = pgTable(
  'wallet_spend_allocations',
  {
    id: uuid('id').primaryKey(),
    spendEntryId: uuid('spend_entry_id')
      .notNull()
      .references(() => walletLedger.id, { onDelete: 'restrict' }),
    lotEntryId: uuid('lot_entry_id')
      .notNull()
      .references(() => walletLedger.id, { onDelete: 'restrict' }),
    kopecks: bigint('kopecks', { mode: 'number' }).notNull(),
  },
  (t) => [
    index('wallet_spend_allocations_spend_idx').on(t.spendEntryId),
    check('wallet_spend_allocations_positive', sql`${t.kopecks} > 0`),
  ],
)

/**
 * Подарочные сертификаты. Полный номер не хранится: только HMAC-хеш канонической формы
 * и последние 4 символа. Активация — один условный переход issued → activated.
 */
export const walletCertificates = pgTable(
  'wallet_certificates',
  {
    id: uuid('id').primaryKey(),
    /** Открытый порядковый номер (С-000123) — выдаёт последовательность БД. */
    serial: integer('serial').generatedAlwaysAsIdentity().notNull().unique(),
    codeHash: text('code_hash').notNull().unique(),
    last4: text('last4').notNull(),
    amountKopecks: bigint('amount_kopecks', { mode: 'number' }).notNull(),
    status: text('status', { enum: ['issued', 'activated', 'annulled'] }).notNull(),
    /** Срок активации; null — бессрочно (театр ещё не решил, PRD §11 п.5). */
    validUntil: timestamp('valid_until', { withTimezone: true }),
    issuedBy: text('issued_by').notNull(),
    comment: text('comment'),
    activatedByCustomer: uuid('activated_by_customer').references(() => customers.id, {
      onDelete: 'restrict',
    }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('wallet_certificates_customer_idx').on(t.activatedByCustomer),
    check('wallet_certificates_amount_positive', sql`${t.amountKopecks} > 0`),
    check(
      'wallet_certificates_activation_shape',
      sql`(${t.status} = 'activated') = (${t.activatedByCustomer} IS NOT NULL AND ${t.activatedAt} IS NOT NULL)`,
    ),
  ],
)

/** Код приглашения зрителя — один на покупателя. */
export const walletReferralCodes = pgTable('wallet_referral_codes', {
  customerId: uuid('customer_id')
    .primaryKey()
    .references(() => customers.id, { onDelete: 'cascade' }),
  code: text('code').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

/**
 * Приглашённые: каждый покупатель привязан не более чем к одному пригласившему, себя
 * пригласить нельзя. `qualified_at` — первая подтверждённая покупка друга (ставится один раз).
 */
export const walletReferrals = pgTable(
  'wallet_referrals',
  {
    id: uuid('id').primaryKey(),
    referrerId: uuid('referrer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    referredCustomerId: uuid('referred_customer_id')
      .notNull()
      .unique()
      .references(() => customers.id, { onDelete: 'restrict' }),
    attachedAt: timestamp('attached_at', { withTimezone: true }).notNull(),
    qualifiedAt: timestamp('qualified_at', { withTimezone: true }),
    /** Награда, начисленная, когда этот друг замкнул тройку. */
    rewardEntryId: uuid('reward_entry_id').references(() => walletLedger.id),
  },
  (t) => [
    index('wallet_referrals_referrer_idx').on(t.referrerId, t.qualifiedAt),
    check('wallet_referrals_not_self', sql`${t.referrerId} <> ${t.referredCustomerId}`),
  ],
)

export const walletTables = {
  wallet_ledger: walletLedger,
  wallet_spend_allocations: walletSpendAllocations,
  wallet_certificates: walletCertificates,
  wallet_referral_codes: walletReferralCodes,
  wallet_referrals: walletReferrals,
}
