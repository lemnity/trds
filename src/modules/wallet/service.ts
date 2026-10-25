import { createHmac, randomInt as cryptoRandomInt, randomUUID } from 'node:crypto'

import {
  CERTIFICATE_ALPHABET,
  LOYALTY_RULES,
  accrualFor,
  availableBalance,
  bonusExpiresAt,
  certificateLast4,
  certificateSerial,
  expiringSoon,
  generateCertificateCode,
  parseCertificateCode,
  planSpend,
  referralProgress,
  type BonusLot,
  type LoyaltySettings,
  type ReferralProgress,
} from '@/modules/loyalty'

/**
 * Бонусный кошелёк (T-060…T-063, T-066, PRD §5.6, §5.8). Только сервер. Правила (проценты, сроки,
 * формат номера) — в `@/modules/loyalty`; здесь — журнал и атомарные операции над ним.
 *
 * Инварианты: суммы — целые копейки; журнал только дополняется (у лота уменьшается лишь остаток,
 * условным UPDATE); каждая операция имеет ключ идемпотентности — повтор события ничего не удваивает;
 * сертификат хранится HMAC-хешем, активируется одним условным переходом. Хранилище — интерфейс
 * `WalletStore` (PostgreSQL или память в тестах и dev).
 */

export type LedgerKind =
  | 'purchase'
  | 'referral'
  | 'certificate'
  | 'spend'
  /** Компенсация списания по несостоявшемуся заказу: лот со сроком исходного лота. */
  | 'release'
  | 'expire'
  | 'manual'
  /** Возврат билета: потраченные на него бонусы — лотом со сроком исходного лота. */
  | 'refund'
  /**
   * Возврат билета: сторно начисленных за него бонусов (строка < 0). Сколько покрыто лотами —
   * в `wallet_spend_allocations`; непокрытая часть — долг (PRD §5.6), её гасят будущие начисления.
   */
  | 'reversal'

export type LedgerEntry = {
  id: string
  customerId: string
  kind: LedgerKind
  /** Со знаком: начисление > 0, списание и сгорание < 0. */
  amountKopecks: number
  /** Остаток лота — только у начислений. */
  lotRemainingKopecks: number | null
  expiresAt: Date | null
  sourceRef: string | null
  idempotencyKey: string
  relatedEntryId: string | null
  createdAt: Date
}

export type CertificateStatus = 'issued' | 'activated' | 'annulled'

export type CertificateRow = {
  id: string
  serial: number
  codeHash: string
  last4: string
  amountKopecks: number
  status: CertificateStatus
  validUntil: Date | null
  issuedBy: string
  comment: string | null
  activatedByCustomer: string | null
  activatedAt: Date | null
  createdAt: Date
}

/** Новый сертификат: порядковый номер выдаёт хранилище (последовательность БД). */
export type NewCertificate = Omit<CertificateRow, 'serial'>

export type ReferralRow = {
  id: string
  referrerId: string
  referredCustomerId: string
  attachedAt: Date
  qualifiedAt: Date | null
  rewardEntryId: string | null
}

export type SpendAllocation = {
  id: string
  spendEntryId: string
  lotEntryId: string
  kopecks: number
}

export type ActivatedCertificate = {
  serial: number
  last4: string
  amountKopecks: number
  activatedAt: Date
  expiresAt: Date
}

/** Операции внутри одной DB-транзакции. Всё, что вернула транзакция с ошибкой, откатывается. */
export interface WalletTx {
  /** Добавить строку журнала; false — строка с таким ключом идемпотентности уже есть. */
  insertEntry(entry: LedgerEntry): Promise<boolean>
  findEntryByKey(idempotencyKey: string): Promise<LedgerEntry | null>
  /** Живые лоты покупателя (остаток > 0, не сгорели к `now`), заблокированные FOR UPDATE по id. */
  lockLiveLots(customerId: string, now: Date): Promise<BonusLot[]>
  /** Уменьшить остаток лота, только если его хватает. true — уменьшили. */
  takeFromLot(lotId: string, kopecks: number): Promise<boolean>
  insertAllocations(rows: SpendAllocation[]): Promise<void>
  /** Из каких лотов сделано списание — со сроком каждого лота (для компенсации). */
  spendAllocations(
    spendEntryId: string,
  ): Promise<{ lotEntryId: string; kopecks: number; expiresAt: Date }[]>
  /** Сгоревшие лоты с остатком; занятые другой транзакцией пропускаются (SKIP LOCKED). */
  lockExpiredLots(
    now: Date,
    limit: number,
  ): Promise<{ id: string; customerId: string; remainingKopecks: number }[]>
  /** Обнулить остаток лота, только если он всё ещё равен `expected`. */
  zeroLot(lotId: string, expected: number): Promise<boolean>
  /**
   * Условный переход issued → activated: только выпущенный, не аннулированный и не просроченный
   * к `now`. null — сертификат недоступен (нет, уже активирован, аннулирован, истёк).
   */
  activateCertificate(
    codeHash: string,
    customerId: string,
    now: Date,
  ): Promise<CertificateRow | null>
  /** Порядковый номер или null — такой хеш уже есть (повторить с новым номером). */
  insertCertificate(row: NewCertificate): Promise<number | null>
  /** Условный переход issued → annulled; активированный не аннулируется. */
  annulCertificate(serial: number): Promise<boolean>
  /** Заблокировать пригласившего: подсчёт засчитанных друзей идёт по одному. */
  lockReferrer(referrerId: string): Promise<void>
  findReferral(referredCustomerId: string): Promise<ReferralRow | null>
  /** Отметить первую покупку друга, только если ещё не отмечена. */
  markQualified(referredCustomerId: string, at: Date): Promise<boolean>
  /**
   * Снять отметку покупки друга (его покупку вернули целиком), только если друг отмечен и ещё
   * не входит в тройку с выданной наградой. true — сняли.
   */
  unmarkQualified(referredCustomerId: string): Promise<boolean>
  countQualified(referrerId: string): Promise<number>
  /** Привязать награду ко всем засчитанным друзьям пригласившего, ещё не вошедшим в награду. */
  setGroupReward(referrerId: string, entryId: string): Promise<void>
  /**
   * Сериализовать операции с долгом покупателя (сторно при возврате ↔ погашение начислением):
   * advisory lock транзакции по покупателю — у покупателя без лотов строк для FOR UPDATE нет.
   */
  lockCustomer(customerId: string): Promise<void>
  /** Сторно с непогашенным остатком (долг), старые первыми. */
  openDebts(customerId: string): Promise<{ entryId: string; outstandingKopecks: number }[]>
  /** Строки покупателя вида `kind` с источником `sourceRef` (например, все возвраты бонусов заказа). */
  entriesBySource(customerId: string, kind: LedgerKind, sourceRef: string): Promise<LedgerEntry[]>
}

export interface WalletStore {
  transaction<T>(fn: (tx: WalletTx) => Promise<T>): Promise<T>
  /** Живые лоты покупателя (для баланса и «сгорят скоро»). */
  liveLots(customerId: string, now: Date): Promise<BonusLot[]>
  /** Последние строки журнала, новые первыми. */
  history(customerId: string, limit: number): Promise<LedgerEntry[]>
  activatedCertificates(customerId: string): Promise<ActivatedCertificate[]>
  referralCode(customerId: string): Promise<string | null>
  /** Сохранить код, если у покупателя его нет и код свободен (иначе ничего не делать). */
  insertReferralCode(customerId: string, code: string, at: Date): Promise<void>
  findReferrerByCode(code: string): Promise<string | null>
  /** false — покупатель уже к кому-то привязан. */
  attachReferral(row: ReferralRow): Promise<boolean>
  qualifiedCount(referrerId: string): Promise<number>
  /** Непогашенный долг покупателя (сумма непокрытых сторно). */
  debt(customerId: string): Promise<number>
}

/** Итог компенсации бонусов по возврату (T-064). */
export type RefundCompensation = {
  /** Возвращено потраченных бонусов (новыми лотами). */
  returnedKopecks: number
  /** Сторно начисления по билетам возврата. */
  reversedKopecks: number
  /** Сколько сторно покрыто балансом; остальное — долг. */
  coveredKopecks: number
  debtKopecks: number
  /** Начисление за заказ ещё не сделано — сторно не из чего (повторить позже, если начислят). */
  accrualMissing: boolean
  duplicate: boolean
}

/** Возврат по заказу, прошедший раньше начисления: доля начисления на его билеты. */
export type EarlierRefund = { refundId: string; kopecks: number }

/** Итог снятия друга со счётчика «Приведи 3 друга» после полного возврата его покупки. */
export type UnqualifyResult =
  | { unqualified: true }
  | {
      unqualified: false
      reason: 'NOT_REFERRED' | 'NOT_QUALIFIED' | 'REWARDED' | 'STILL_QUALIFIES'
    }

type Deps = {
  store: WalletStore
  /** Секрет HMAC для номеров сертификатов (из PAYLOAD_SECRET, метка 'turdus:certificate'). */
  secret: string
  settings?: LoyaltySettings
  /** Криптографический генератор целых в [0, max). */
  randomInt?: (max: number) => number
}

export type WalletSummary = {
  balanceKopecks: number
  expiring: { amountKopecks: number; earliest: Date } | null
  history: {
    id: string
    kind: LedgerKind
    amountKopecks: number
    at: Date
    expiresAt: Date | null
  }[]
  referral: { code: string; qualified: number; progress: ReferralProgress }
  certificates: {
    serial: string
    last4: string
    amountKopecks: number
    activatedAt: Date
    expiresAt: Date
  }[]
}

export type ActivateResult =
  | { ok: true; amountKopecks: number; expiresAt: Date; balanceKopecks: number }
  | { ok: false; error: 'FORMAT' | 'CHECKSUM' | 'NOT_AVAILABLE' }

export type SpendResult =
  | { ok: true; entryId: string | null; amountKopecks: number; duplicate: boolean }
  | { ok: false; error: 'INSUFFICIENT' | 'IDEMPOTENCY_CONFLICT' }

export type AttachResult =
  { ok: true } | { ok: false; error: 'UNKNOWN_CODE' | 'SELF' | 'ALREADY_ATTACHED' }

export const HISTORY_LIMIT = 50
export const MAX_CERTIFICATES_PER_BATCH = 500
const REFERRAL_CODE_LENGTH = 8
const EXPIRE_BATCH = 500

const isKopecks = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Откат транзакции при нехватке баланса — наружу не выходит. */
class InsufficientBalance extends Error {}

export function createWalletService({
  store,
  secret,
  settings = LOYALTY_RULES,
  randomInt = (max) => cryptoRandomInt(max),
}: Deps) {
  const hashCertificate = (canonical: string) =>
    createHmac('sha256', secret).update(canonical).digest('hex')

  const randomReferralCode = () => {
    let code = ''
    for (let i = 0; i < REFERRAL_CODE_LENGTH; i++)
      code += CERTIFICATE_ALPHABET[randomInt(CERTIFICATE_ALPHABET.length)]
    return code
  }

  const lot = (
    customerId: string,
    kind: LedgerKind,
    amountKopecks: number,
    at: Date,
    idempotencyKey: string,
    sourceRef: string | null,
  ): LedgerEntry => ({
    id: randomUUID(),
    customerId,
    kind,
    amountKopecks,
    lotRemainingKopecks: amountKopecks,
    expiresAt: bonusExpiresAt(at, settings),
    sourceRef,
    idempotencyKey,
    relatedEntryId: null,
    createdAt: at,
  })

  const balance = async (customerId: string, now: Date) =>
    availableBalance(await store.liveLots(customerId, now), now)

  /** Код приглашения покупателя; создаётся при первом обращении. */
  async function ensureReferralCode(customerId: string, now = new Date()) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await store.referralCode(customerId)
      if (existing) return existing
      // Параллельный вызов или совпадение кода — insert ничего не сделает, перечитываем.
      await store.insertReferralCode(customerId, randomReferralCode(), now)
    }
    const code = await store.referralCode(customerId)
    if (!code) throw new Error('referral code allocation failed')
    return code
  }

  async function summary(customerId: string, now: Date): Promise<WalletSummary> {
    const [lots, entries, certificates, code, qualified] = await Promise.all([
      store.liveLots(customerId, now),
      store.history(customerId, HISTORY_LIMIT),
      store.activatedCertificates(customerId),
      ensureReferralCode(customerId, now),
      // Пока код создаётся впервые, засчитанных друзей быть не может — порядок не важен.
      store.qualifiedCount(customerId),
    ])
    return {
      balanceKopecks: availableBalance(lots, now),
      expiring: expiringSoon(lots, now),
      history: entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        amountKopecks: e.amountKopecks,
        at: e.createdAt,
        expiresAt: e.expiresAt,
      })),
      referral: { code, qualified, progress: referralProgress(qualified, settings) },
      certificates: certificates.map((c) => ({
        serial: certificateSerial(c.serial),
        last4: c.last4,
        amountKopecks: c.amountKopecks,
        activatedAt: c.activatedAt,
        expiresAt: c.expiresAt,
      })),
    }
  }

  /**
   * Активация сертификата: номинал зачисляется лотом `certificate` со сроком 1 год. Ошибки формата
   * и контрольного символа — до обращения к базе; «нет», «уже активирован», «аннулирован»,
   * «истёк» — один и тот же NOT_AVAILABLE, чтобы ответ не раскрывал состояние чужого номера.
   * Бонусы за сертификат не начисляются (PRD §5.6).
   */
  async function activateCertificate(
    customerId: string,
    input: unknown,
    now: Date,
  ): Promise<ActivateResult> {
    if (typeof input !== 'string' || input.length > 64) return { ok: false, error: 'FORMAT' }
    const parsed = parseCertificateCode(input)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const codeHash = hashCertificate(parsed.canonical)
    const credited = await store.transaction(async (tx) => {
      const certificate = await tx.activateCertificate(codeHash, customerId, now)
      if (!certificate) return null
      const entry = lot(
        customerId,
        'certificate',
        certificate.amountKopecks,
        now,
        `certificate:${certificate.id}`,
        certificate.id,
      )
      // Ключ уникален, переход issued → activated возможен один раз — второй строки не будет.
      if (!(await tx.insertEntry(entry))) throw new Error('certificate already credited')
      return entry
    })
    if (!credited) return { ok: false, error: 'NOT_AVAILABLE' }
    return {
      ok: true,
      amountKopecks: credited.amountKopecks,
      expiresAt: credited.expiresAt!,
      balanceKopecks: await balance(customerId, now),
    }
  }

  /**
   * Выпуск партии сертификатов. Полный номер существует только в ответе — в базе хеш и последние
   * 4 символа. Партия выпускается одной транзакцией: либо вся, либо ничего.
   */
  async function issueCertificates(
    input: {
      amountKopecks: number
      count: number
      validUntil?: Date | null
      comment?: string | null
      issuedBy: string
    },
    now = new Date(),
  ): Promise<{ serial: string; code: string }[]> {
    const { amountKopecks, count } = input
    if (!isKopecks(amountKopecks) || amountKopecks === 0 || amountKopecks % 100 !== 0)
      throw new RangeError('amountKopecks must be a positive whole number of rubles')
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_CERTIFICATES_PER_BATCH)
      throw new RangeError(`count must be 1..${MAX_CERTIFICATES_PER_BATCH}`)
    const validUntil = input.validUntil ?? null
    if (validUntil && !(validUntil > now)) throw new RangeError('validUntil must be in the future')
    const issuedBy = input.issuedBy.trim()
    if (!issuedBy || issuedBy.length > 100) throw new RangeError('issuedBy is required')
    const comment = input.comment?.trim().slice(0, 500) || null

    return store.transaction(async (tx) => {
      const issued: { serial: string; code: string }[] = []
      for (let i = 0; i < count; i++) {
        for (let attempt = 0; ; attempt++) {
          if (attempt === 5) throw new Error('certificate code collision')
          const code = generateCertificateCode(randomInt)
          const parsed = parseCertificateCode(code)
          if (!parsed.ok) throw new Error('generated certificate code is invalid')
          const serial = await tx.insertCertificate({
            id: randomUUID(),
            codeHash: hashCertificate(parsed.canonical),
            last4: certificateLast4(parsed.canonical),
            amountKopecks,
            status: 'issued',
            validUntil,
            issuedBy,
            comment,
            activatedByCustomer: null,
            activatedAt: null,
            createdAt: now,
          })
          if (serial === null) continue // совпал хеш — новый номер
          issued.push({ serial: certificateSerial(serial), code })
          break
        }
      }
      return issued
    })
  }

  /**
   * Списание бонусов по заказу — при оформлении, до создания платежа (T-061); если заказ
   * не состоится, списание компенсирует `releaseSpend`. Сначала из лотов, которые сгорят раньше. Лоты блокируются в детерминированном порядке,
   * остаток уменьшается условно; повтор с тем же `orderRef` возвращает уже сделанное списание.
   */
  async function spend(
    customerId: string,
    amountKopecks: number,
    orderRef: string,
    now: Date,
  ): Promise<SpendResult> {
    if (!isKopecks(amountKopecks)) throw new RangeError('amountKopecks must be integer kopecks')
    if (!orderRef) throw new RangeError('orderRef is required')
    if (amountKopecks === 0) return { ok: true, entryId: null, amountKopecks: 0, duplicate: false }
    const idempotencyKey = `spend:${orderRef}`
    const entry: LedgerEntry = {
      id: randomUUID(),
      customerId,
      kind: 'spend',
      amountKopecks: -amountKopecks,
      lotRemainingKopecks: null,
      expiresAt: null,
      sourceRef: orderRef,
      idempotencyKey,
      relatedEntryId: null,
      createdAt: now,
    }
    try {
      return await store.transaction<SpendResult>(async (tx) => {
        // Сначала ключ: параллельный повтор того же заказа ждёт на уникальном индексе.
        if (!(await tx.insertEntry(entry))) {
          const existing = await tx.findEntryByKey(idempotencyKey)
          if (existing?.customerId !== customerId || existing.amountKopecks !== -amountKopecks)
            return { ok: false, error: 'IDEMPOTENCY_CONFLICT' }
          return { ok: true, entryId: existing.id, amountKopecks, duplicate: true }
        }
        const lots = await tx.lockLiveLots(customerId, now)
        const plan = planSpend(lots, amountKopecks, now)
        if (!plan) throw new InsufficientBalance()
        for (const part of plan)
          if (!(await tx.takeFromLot(part.lotId, part.kopecks))) throw new InsufficientBalance()
        await tx.insertAllocations(
          plan.map((p) => ({
            id: randomUUID(),
            spendEntryId: entry.id,
            lotEntryId: p.lotId,
            kopecks: p.kopecks,
          })),
        )
        return { ok: true, entryId: entry.id, amountKopecks, duplicate: false }
      })
    } catch (error) {
      if (error instanceof InsufficientBalance) return { ok: false, error: 'INSUFFICIENT' }
      throw error
    }
  }

  const releaseKey = (orderRef: string, lotEntryId: string) => `release:${orderRef}:${lotEntryId}`

  /**
   * Компенсация списания по заказу, который не состоялся (истёк, отменён, платёж отклонён).
   * Исходные строки не меняются: на каждую долю списания — новый лот `release` с той же суммой
   * и сроком исходного лота (бонусы не «молодеют»; уже сгоревшие сгорят при следующем проходе).
   * Ключ `release:<orderRef>:<lotId>` — повтор и параллельный вызов ничего не удваивают.
   */
  async function releaseSpend(orderRef: string, now: Date) {
    if (!orderRef) throw new RangeError('orderRef is required')
    return store.transaction(async (tx) => {
      const spent = await tx.findEntryByKey(`spend:${orderRef}`)
      if (!spent) return { releasedKopecks: 0, duplicate: false }
      const parts = await tx.spendAllocations(spent.id)
      let releasedKopecks = 0
      let duplicate = false
      for (const part of parts) {
        const inserted = await tx.insertEntry({
          id: randomUUID(),
          customerId: spent.customerId,
          kind: 'release',
          amountKopecks: part.kopecks,
          lotRemainingKopecks: part.kopecks,
          expiresAt: part.expiresAt,
          sourceRef: orderRef,
          idempotencyKey: releaseKey(orderRef, part.lotEntryId),
          relatedEntryId: part.lotEntryId,
          createdAt: now,
        })
        // Все доли пишутся одной транзакцией: первая уже есть — значит, есть и остальные.
        if (!inserted) duplicate = true
        else releasedKopecks += part.kopecks
      }
      if (duplicate && releasedKopecks > 0) throw new Error('wallet release partially applied')
      return { releasedKopecks, duplicate }
    })
  }

  /** Состояние списания по заказу: не было, действует или компенсировано. */
  async function spendStatus(orderRef: string): Promise<'none' | 'spent' | 'released'> {
    return store.transaction(async (tx) => {
      const spent = await tx.findEntryByKey(`spend:${orderRef}`)
      if (!spent) return 'none'
      const [first] = await tx.spendAllocations(spent.id)
      if (!first) return 'spent'
      return (await tx.findEntryByKey(releaseKey(orderRef, first.lotEntryId)))
        ? 'released'
        : 'spent'
    })
  }

  /** Аннулировать невыданный/утерянный сертификат по порядковому номеру (до активации). */
  async function annulCertificate(serial: number) {
    if (!Number.isSafeInteger(serial) || serial < 1) return false
    return store.transaction((tx) => tx.annulCertificate(serial))
  }

  /**
   * Начисление 3% за оплаченные деньгами билеты — только по подтверждённому платежу (вызов из
   * обработки оплаты, `@/modules/payments`). Часть, оплаченная бонусами и сертификатом, в базу
   * не входит. Повтор — no-op.
   *
   * `earlierRefunds` (T-064): заказ успели частично вернуть раньше, чем прошло начисление, —
   * тогда начисляется 3% от всего заказа и в той же транзакции сторнируются доли уже возвращённых
   * билетов (ключ `reversal:<refundId>`, как у сторно при возврате). Итог — 3% от денег за
   * оставшиеся билеты, а доли начисления по билетам остаются прежними: следующий возврат
   * сторнирует ровно свою долю. Вызывается под блокировкой покупателя: возврат, чьи бонусы уже
   * урегулированы «без начисления», к этому моменту виден как SUCCEEDED; более поздний — увидит
   * начисление и сторнирует сам (тот же ключ — не дважды).
   */
  async function accrue(
    customerId: string,
    cashForTicketsKopecks: number,
    orderRef: string,
    now: Date,
    {
      earlierRefunds,
    }: { earlierRefunds?: (accruedKopecks: number) => Promise<EarlierRefund[]> } = {},
  ) {
    if (!orderRef) throw new RangeError('orderRef is required')
    const amountKopecks = accrualFor(cashForTicketsKopecks, settings)
    if (amountKopecks === 0) return { amountKopecks: 0, duplicate: false }
    const entry = lot(customerId, 'purchase', amountKopecks, now, `purchase:${orderRef}`, orderRef)
    // Новое начисление сначала гасит долг по сторно (PRD §5.6) — в той же транзакции.
    const result = await store.transaction(async (tx) => {
      await tx.lockCustomer(customerId)
      if (!(await tx.insertEntry(entry))) return { inserted: false, repaid: 0, reversed: 0 }
      let reversed = 0
      for (const r of earlierRefunds ? await earlierRefunds(amountKopecks) : []) {
        if (!isKopecks(r.kopecks)) throw new RangeError('reversal share is out of range')
        if (r.kopecks === 0) continue
        const done = await reverseAccrual(tx, {
          customerId,
          orderId: orderRef,
          refundId: r.refundId,
          accrual: entry,
          share: r.kopecks,
          now,
        })
        if (!done.duplicate) reversed += done.reversedKopecks
      }
      if (reversed > amountKopecks) throw new RangeError('reversal exceeds accrual')
      return {
        inserted: true,
        repaid: await repayDebt(tx, entry, amountKopecks - reversed),
        reversed,
      }
    })
    return {
      amountKopecks,
      duplicate: !result.inserted,
      // Только если что-то погашено/сторнировано: форма ответа без них прежняя.
      ...(result.repaid > 0 && { debtRepaidKopecks: result.repaid }),
      ...(result.reversed > 0 && { reversedKopecks: result.reversed }),
    }
  }

  /**
   * Погасить долг покупателя из только что созданного лота (внутри транзакции начисления):
   * остаток лота уменьшается, погашение — строки `wallet_spend_allocations` к строке сторно.
   * Доступный баланс не становится отрицательным: берётся не больше остатка лота.
   */
  const repayDebt = async (tx: WalletTx, entry: LedgerEntry, available = entry.amountKopecks) => {
    let left = available
    for (const debt of await tx.openDebts(entry.customerId)) {
      if (left === 0) break
      const take = Math.min(left, debt.outstandingKopecks)
      if (!(await tx.takeFromLot(entry.id, take)))
        throw new Error('wallet ledger invariant violated on debt repayment')
      await tx.insertAllocations([
        { id: randomUUID(), spendEntryId: debt.entryId, lotEntryId: entry.id, kopecks: take },
      ])
      left -= take
    }
    return available - left
  }

  /**
   * Сторно доли начисления `accrual` по возврату `refundId` (внутри транзакции, под блокировкой
   * покупателя). Берётся из лота начисления, затем из остального баланса (сначала сгорающее
   * раньше); чего не хватило — долг. Повтор по тому же возврату — duplicate.
   */
  const reverseAccrual = async (
    tx: WalletTx,
    {
      customerId,
      orderId,
      refundId,
      accrual,
      share,
      now,
    }: {
      customerId: string
      orderId: string
      refundId: string
      accrual: LedgerEntry
      share: number
      now: Date
    },
  ) => {
    const reversed = await tx.findEntryByKey(`reversal:${refundId}`)
    if (reversed)
      return {
        duplicate: true,
        reversedKopecks: -reversed.amountKopecks,
        coveredKopecks: 0,
        debtKopecks: 0,
      }
    const lots = await tx.lockLiveLots(customerId, now)
    const own = lots.find((l) => l.id === accrual.id)
    const rest = lots
      .filter((l) => l.id !== accrual.id)
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id))
    const reversal: LedgerEntry = {
      id: randomUUID(),
      customerId,
      kind: 'reversal',
      amountKopecks: -share,
      lotRemainingKopecks: null,
      expiresAt: null,
      sourceRef: orderId,
      idempotencyKey: `reversal:${refundId}`,
      relatedEntryId: accrual.id,
      createdAt: now,
    }
    if (!(await tx.insertEntry(reversal))) throw new Error('wallet reversal changed concurrently')
    let need = share
    for (const lot of own ? [own, ...rest] : rest) {
      if (need === 0) break
      const take = Math.min(need, lot.remainingKopecks)
      if (take === 0) continue
      if (!(await tx.takeFromLot(lot.id, take))) throw new Error('wallet lot changed under lock')
      await tx.insertAllocations([
        { id: randomUUID(), spendEntryId: reversal.id, lotEntryId: lot.id, kopecks: take },
      ])
      need -= take
    }
    return {
      duplicate: false,
      reversedKopecks: share,
      coveredKopecks: share - need,
      debtKopecks: need,
    }
  }

  /** Активное списание по заказу: при поздней оплате — повторное (`spend:<order>:late`). */
  const activeSpend = async (tx: WalletTx, orderId: string) => {
    const late = await tx.findEntryByKey(`spend:${orderId}:late`)
    if (late) return { entry: late, ref: `${orderId}:late` }
    const spent = await tx.findEntryByKey(`spend:${orderId}`)
    if (!spent) return null
    const parts = await tx.spendAllocations(spent.id)
    // Списание уже компенсировано (заказ не состоялся) — возвращать нечего.
    if (parts[0] && (await tx.findEntryByKey(releaseKey(orderId, parts[0].lotEntryId)))) return null
    return { entry: spent, ref: orderId }
  }

  /**
   * Бонусы при возврате билетов (T-064, PRD §5.6). Одна транзакция, исходные строки не меняются:
   *
   * 1. Потраченные на билеты бонусы (`returnSpentKopecks`) возвращаются новыми лотами `refund`
   *    со сроком исходных лотов — из долей списания заказа, ещё не возвращённых прежними
   *    возвратами (сначала лоты с самым поздним сроком). Ключ `refund:<refundId>:<lotId>`.
   * 2. Начисление 3% за заказ сторнируется на долю билетов (`reversalShare(начислено)` —
   *    детерминированно, `allocate` по билетам). Сторно берётся из лота начисления, затем из
   *    остального баланса (сначала сгорающее раньше); чего не хватило — долг: доступный баланс
   *    не уходит в минус, долг гасят будущие начисления (`repayDebt`). Ключ `reversal:<refundId>`.
   *
   * Повтор и параллельный вызов по тому же возврату ничего не удваивают (ключи + блокировка
   * покупателя). Правило долга — допущение до подтверждения театром (PRD §5.6, §11).
   */
  async function compensateRefund(
    input: {
      customerId: string
      orderId: string
      refundId: string
      returnSpentKopecks: number
      /** Сколько из начисленного за заказ приходится на билеты возврата. */
      reversalShare: (accruedKopecks: number) => number
    },
    now: Date,
  ): Promise<RefundCompensation> {
    const { customerId, orderId, refundId } = input
    if (!customerId || !orderId || !refundId) throw new RangeError('ids are required')
    if (!isKopecks(input.returnSpentKopecks))
      throw new RangeError('returnSpentKopecks must be integer kopecks')
    return store.transaction(async (tx) => {
      await tx.lockCustomer(customerId)
      const result: RefundCompensation = {
        returnedKopecks: 0,
        reversedKopecks: 0,
        coveredKopecks: 0,
        debtKopecks: 0,
        accrualMissing: false,
        duplicate: false,
      }
      // Каждый шаг идемпотентен сам по себе: шаг 2 можно доделать позже (начисление пришло после).
      // 1. Возврат потраченных бонусов.
      let left = input.returnSpentKopecks
      const spend = left > 0 ? await activeSpend(tx, orderId) : null
      if (spend) {
        const returned = new Map<string, number>()
        let done = false
        for (const e of await tx.entriesBySource(customerId, 'refund', spend.ref)) {
          if (e.idempotencyKey.startsWith(`refund:${refundId}:`)) done = true
          if (e.relatedEntryId)
            returned.set(e.relatedEntryId, (returned.get(e.relatedEntryId) ?? 0) + e.amountKopecks)
        }
        if (done) {
          result.duplicate = true
          left = 0
        }
        const parts = (await tx.spendAllocations(spend.entry.id)).sort(
          (a, b) =>
            b.expiresAt.getTime() - a.expiresAt.getTime() ||
            a.lotEntryId.localeCompare(b.lotEntryId),
        )
        for (const part of parts) {
          if (left === 0) break
          const take = Math.min(left, part.kopecks - (returned.get(part.lotEntryId) ?? 0))
          if (take <= 0) continue
          const inserted = await tx.insertEntry({
            id: randomUUID(),
            customerId,
            kind: 'refund',
            amountKopecks: take,
            lotRemainingKopecks: take,
            expiresAt: part.expiresAt,
            sourceRef: spend.ref,
            idempotencyKey: `refund:${refundId}:${part.lotEntryId}`,
            relatedEntryId: part.lotEntryId,
            createdAt: now,
          })
          if (!inserted) throw new Error('wallet refund partially applied')
          result.returnedKopecks += take
          left -= take
        }
      }

      // 2. Сторно начисления за билеты возврата.
      const accrual = await tx.findEntryByKey(`purchase:${orderId}`)
      if (!accrual) result.accrualMissing = true
      const share = accrual ? input.reversalShare(accrual.amountKopecks) : 0
      if (!isKopecks(share) || share > (accrual?.amountKopecks ?? 0))
        throw new RangeError('reversal share is out of range')
      if (share > 0) {
        const done = await reverseAccrual(tx, {
          customerId,
          orderId,
          refundId,
          accrual: accrual!,
          share,
          now,
        })
        if (done.duplicate) result.duplicate = true
        result.reversedKopecks = done.reversedKopecks
        result.coveredKopecks = done.coveredKopecks
        result.debtKopecks = done.debtKopecks
      }
      return result
    })
  }

  /** Привязать нового покупателя к пригласившему по коду (при регистрации). */
  async function attachReferral(
    referredCustomerId: string,
    code: string,
    now: Date,
  ): Promise<AttachResult> {
    const normalized = code.trim().toUpperCase()
    if (!/^[A-Z0-9]{1,16}$/.test(normalized)) return { ok: false, error: 'UNKNOWN_CODE' }
    const referrerId = await store.findReferrerByCode(normalized)
    if (!referrerId) return { ok: false, error: 'UNKNOWN_CODE' }
    if (referrerId === referredCustomerId) return { ok: false, error: 'SELF' }
    const attached = await store.attachReferral({
      id: randomUUID(),
      referrerId,
      referredCustomerId,
      attachedAt: now,
      qualifiedAt: null,
      rewardEntryId: null,
    })
    return attached ? { ok: true } : { ok: false, error: 'ALREADY_ATTACHED' }
  }

  /**
   * Первая подтверждённая покупка приглашённого (вызывает заказ, T-040 — только для первой оплаты).
   * Засчитывается один раз; на каждом кратном 3 засчитанном друге пригласившему — 1000 ₽ лотом
   * `referral` с ключом `referral:<referrerId>:<n>`: повторные webhook и параллельные покупки
   * друзей награду не удваивают. Награда привязывается ко всем трём друзьям тройки — после неё
   * никого из них со счётчика не снимают (`unqualifyReferral`).
   *
   * `stillPaid` — проверка под блокировкой пригласившего, что покупка всё ещё действует: иначе
   * запоздалый вызов (заказ прочитан оплаченным, а его тут же вернули целиком и друга уже сняли)
   * засчитал бы друга снова.
   */
  async function qualifyReferral(
    referredCustomerId: string,
    now: Date,
    { stillPaid }: { stillPaid?: () => Promise<boolean> } = {},
  ) {
    return store.transaction(async (tx) => {
      const referral = await tx.findReferral(referredCustomerId)
      if (!referral) return { qualified: false as const, rewarded: false }
      await tx.lockReferrer(referral.referrerId)
      if (stillPaid && !(await stillPaid())) return { qualified: false as const, rewarded: false }
      if (!(await tx.markQualified(referredCustomerId, now)))
        return { qualified: false as const, rewarded: false }
      const count = await tx.countQualified(referral.referrerId)
      if (count % settings.referralGroupSize !== 0)
        return { qualified: true as const, rewarded: false }
      const round = count / settings.referralGroupSize
      const reward = lot(
        referral.referrerId,
        'referral',
        settings.referralRewardKopecks,
        now,
        `referral:${referral.referrerId}:${round}`,
        referredCustomerId,
      )
      const rewarded = await tx.insertEntry(reward)
      if (rewarded) {
        await tx.setGroupReward(referral.referrerId, reward.id)
        await tx.lockCustomer(referral.referrerId)
        await repayDebt(tx, reward)
      }
      return { qualified: true as const, rewarded }
    })
  }

  /**
   * T-062: покупку друга вернули целиком — он больше не засчитан, если награда за его тройку ещё
   * не выдана (счётчик пригласившего уменьшается, следующий друг займёт его место). Если награда
   * уже выдана, её не отбираем и друга не снимаем: 1000 ₽ могли быть потрачены, а сторно награды
   * сделало бы пригласившего должником за чужой возврат (решение 26.10.2026 до ответа театра).
   *
   * `stillQualifies` — под блокировкой пригласившего: есть ли у друга другая действующая покупка
   * (тогда он по-прежнему засчитан). Повтор — no-op. Друг, снятый со счётчика, засчитается снова
   * следующей оплаченной покупкой (`qualifyReferral`).
   */
  async function unqualifyReferral(
    referredCustomerId: string,
    { stillQualifies }: { stillQualifies: () => Promise<boolean> },
  ): Promise<UnqualifyResult> {
    return store.transaction(async (tx) => {
      const referral = await tx.findReferral(referredCustomerId)
      if (!referral) return { unqualified: false, reason: 'NOT_REFERRED' }
      await tx.lockReferrer(referral.referrerId)
      const fresh = await tx.findReferral(referredCustomerId)
      if (!fresh?.qualifiedAt) return { unqualified: false, reason: 'NOT_QUALIFIED' }
      if (fresh.rewardEntryId) return { unqualified: false, reason: 'REWARDED' }
      if (await stillQualifies()) return { unqualified: false, reason: 'STILL_QUALIFIES' }
      if (!(await tx.unmarkQualified(referredCustomerId)))
        throw new Error('referral changed under lock')
      return { unqualified: true }
    })
  }

  /**
   * Сгорание (worker, T-063): по каждому лоту с истёкшим сроком и остатком — одна строка `expire`
   * на весь остаток (ключ `expire:<lotId>`) и обнуление остатка, в одной транзакции.
   */
  async function expireDue(now: Date) {
    let lots = 0
    let kopecks = 0
    for (;;) {
      const batch = await store.transaction(async (tx) => {
        const due = await tx.lockExpiredLots(now, EXPIRE_BATCH)
        for (const item of due) {
          const inserted = await tx.insertEntry({
            id: randomUUID(),
            customerId: item.customerId,
            kind: 'expire',
            amountKopecks: -item.remainingKopecks,
            lotRemainingKopecks: null,
            expiresAt: null,
            sourceRef: item.id,
            idempotencyKey: `expire:${item.id}`,
            relatedEntryId: item.id,
            createdAt: now,
          })
          // Строка сгорания и обнуление — в одной транзакции, остаток только уменьшается:
          // лот с остатком и уже записанным сгоранием означает нарушение инварианта.
          if (!inserted || !(await tx.zeroLot(item.id, item.remainingKopecks)))
            throw new Error('wallet ledger invariant violated on expire')
        }
        return due
      })
      lots += batch.length
      kopecks += batch.reduce((sum, item) => sum + item.remainingKopecks, 0)
      if (batch.length < EXPIRE_BATCH) return { lots, kopecks }
    }
  }

  return {
    summary,
    activateCertificate,
    issueCertificates,
    spend,
    releaseSpend,
    spendStatus,
    accrue,
    attachReferral,
    qualifyReferral,
    unqualifyReferral,
    expireDue,
    annulCertificate,
    ensureReferralCode,
    balance,
    compensateRefund,
    debt: (customerId: string) => store.debt(customerId),
  }
}

export type WalletService = ReturnType<typeof createWalletService>

/**
 * Хранилище в памяти — для тестов и dev без базы. Не для production. Моделирует поведение
 * PostgreSQL, чтобы параллельные тесты были содержательными: блокировки строк (до конца
 * транзакции), ожидание на уникальном ключе чужой незавершённой транзакции, откат при ошибке;
 * каждое условное изменение — проверка и запись без `await` между ними.
 */
export function memoryWalletStore(): WalletStore & {
  dump: () => {
    ledger: LedgerEntry[]
    certificates: CertificateRow[]
    referrals: ReferralRow[]
    allocations: SpendAllocation[]
  }
} {
  const ledger: LedgerEntry[] = []
  const allocations: SpendAllocation[] = []
  const certificates: CertificateRow[] = []
  const referralCodes: { customerId: string; code: string; createdAt: Date }[] = []
  const referrals: ReferralRow[] = []
  let serialSeq = 0

  // Блокировки: ключ → обещание освобождения. Проверка и захват — без await между ними.
  const locks = new Map<string, Promise<void>>()
  // Незавершённые вставки по ключу идемпотентности — как ожидание на уникальном индексе.
  const pendingKeys = new Map<string, Promise<void>>()
  const pause = () => new Promise<void>((resolve) => setImmediate(resolve))

  const isLot = (e: LedgerEntry) => e.amountKopecks > 0 && e.lotRemainingKopecks !== null
  const copy = <T extends object>(row: T): T => ({ ...row })
  /** Сторно с непокрытым остатком: −сумма − погашено долями. */
  const openDebtsOf = (customerId: string) =>
    ledger
      .filter((e) => e.customerId === customerId && e.kind === 'reversal')
      .map((e) => ({
        entryId: e.id,
        createdAt: e.createdAt,
        outstandingKopecks:
          -e.amountKopecks -
          allocations.filter((a) => a.spendEntryId === e.id).reduce((n, a) => n + a.kopecks, 0),
      }))
      .filter((d) => d.outstandingKopecks > 0)
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() || a.entryId.localeCompare(b.entryId),
      )
      .map(({ entryId, outstandingKopecks }) => ({ entryId, outstandingKopecks }))

  return {
    async transaction(fn) {
      const undo: (() => void)[] = []
      const held = new Map<string, () => void>()
      const ownKeys = new Set<string>()
      let settle!: () => void
      const done = new Promise<void>((resolve) => (settle = resolve))

      const lock = async (key: string) => {
        if (held.has(key)) return
        for (let current = locks.get(key); current; current = locks.get(key)) await current
        let release!: () => void
        locks.set(key, new Promise<void>((resolve) => (release = resolve)))
        held.set(key, () => {
          locks.delete(key)
          release()
        })
      }
      const tryLock = (key: string) => {
        if (held.has(key)) return true
        if (locks.has(key)) return false
        let release!: () => void
        locks.set(key, new Promise<void>((resolve) => (release = resolve)))
        held.set(key, () => {
          locks.delete(key)
          release()
        })
        return true
      }

      const tx: WalletTx = {
        async insertEntry(entry) {
          await pause()
          for (
            let pending = pendingKeys.get(entry.idempotencyKey);
            pending && !ownKeys.has(entry.idempotencyKey);
            pending = pendingKeys.get(entry.idempotencyKey)
          )
            await pending
          if (ledger.some((e) => e.idempotencyKey === entry.idempotencyKey)) return false
          const row = copy(entry)
          ledger.push(row)
          ownKeys.add(entry.idempotencyKey)
          pendingKeys.set(entry.idempotencyKey, done)
          undo.push(() => ledger.splice(ledger.indexOf(row), 1))
          return true
        },
        async findEntryByKey(key) {
          await pause()
          const e = ledger.find((x) => x.idempotencyKey === key)
          return e ? copy(e) : null
        },
        async lockLiveLots(customerId, now) {
          await lock(`lots:${customerId}`)
          return ledger
            .filter(
              (e) =>
                e.customerId === customerId &&
                isLot(e) &&
                e.lotRemainingKopecks! > 0 &&
                e.expiresAt! > now,
            )
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((e) => ({
              id: e.id,
              remainingKopecks: e.lotRemainingKopecks!,
              expiresAt: e.expiresAt!,
            }))
        },
        async takeFromLot(lotId, kopecks) {
          await pause()
          const e = ledger.find((x) => x.id === lotId)
          if (!e || e.lotRemainingKopecks === null || e.lotRemainingKopecks < kopecks) return false
          e.lotRemainingKopecks -= kopecks
          undo.push(() => (e.lotRemainingKopecks! += kopecks))
          return true
        },
        async insertAllocations(rows) {
          await pause()
          const added = rows.map(copy)
          allocations.push(...added)
          undo.push(() => {
            for (const row of added) allocations.splice(allocations.indexOf(row), 1)
          })
        },
        async spendAllocations(spendEntryId) {
          await pause()
          return allocations
            .filter((a) => a.spendEntryId === spendEntryId)
            .sort((a, b) => a.lotEntryId.localeCompare(b.lotEntryId))
            .map((a) => ({
              lotEntryId: a.lotEntryId,
              kopecks: a.kopecks,
              expiresAt: ledger.find((e) => e.id === a.lotEntryId)!.expiresAt!,
            }))
        },
        async lockExpiredLots(now, limit) {
          await pause()
          const due = ledger
            .filter((e) => isLot(e) && e.lotRemainingKopecks! > 0 && e.expiresAt! <= now)
            .sort((a, b) => a.id.localeCompare(b.id))
            // SKIP LOCKED: лоты покупателя, у которого идёт списание, — в следующий проход.
            .filter((e) => tryLock(`lots:${e.customerId}`))
            .slice(0, limit)
          return due.map((e) => ({
            id: e.id,
            customerId: e.customerId,
            remainingKopecks: e.lotRemainingKopecks!,
          }))
        },
        async zeroLot(lotId, expected) {
          await pause()
          const e = ledger.find((x) => x.id === lotId)
          if (!e || e.lotRemainingKopecks !== expected) return false
          e.lotRemainingKopecks = 0
          undo.push(() => (e.lotRemainingKopecks = expected))
          return true
        },
        async activateCertificate(codeHash, customerId, now) {
          await lock(`certificate:${codeHash}`)
          const c = certificates.find((x) => x.codeHash === codeHash)
          if (!c || c.status !== 'issued' || (c.validUntil && c.validUntil <= now)) return null
          c.status = 'activated'
          c.activatedByCustomer = customerId
          c.activatedAt = now
          undo.push(() => {
            c.status = 'issued'
            c.activatedByCustomer = null
            c.activatedAt = null
          })
          return copy(c)
        },
        async insertCertificate(row) {
          await pause()
          if (certificates.some((c) => c.codeHash === row.codeHash)) return null
          const stored = { ...row, serial: ++serialSeq }
          certificates.push(stored)
          undo.push(() => certificates.splice(certificates.indexOf(stored), 1))
          return stored.serial
        },
        async annulCertificate(serial) {
          await pause()
          const c = certificates.find((x) => x.serial === serial)
          if (!c || c.status !== 'issued') return false
          c.status = 'annulled'
          undo.push(() => (c.status = 'issued'))
          return true
        },
        async lockReferrer(referrerId) {
          await lock(`referrer:${referrerId}`)
        },
        async findReferral(referredCustomerId) {
          await pause()
          const r = referrals.find((x) => x.referredCustomerId === referredCustomerId)
          return r ? copy(r) : null
        },
        async markQualified(referredCustomerId, at) {
          await pause()
          const r = referrals.find((x) => x.referredCustomerId === referredCustomerId)
          if (!r || r.qualifiedAt) return false
          r.qualifiedAt = at
          undo.push(() => (r.qualifiedAt = null))
          return true
        },
        async countQualified(referrerId) {
          await pause()
          return referrals.filter((r) => r.referrerId === referrerId && r.qualifiedAt).length
        },
        async unmarkQualified(referredCustomerId) {
          await pause()
          const r = referrals.find((x) => x.referredCustomerId === referredCustomerId)
          if (!r || !r.qualifiedAt || r.rewardEntryId) return false
          const previous = r.qualifiedAt
          r.qualifiedAt = null
          undo.push(() => (r.qualifiedAt = previous))
          return true
        },
        async setGroupReward(referrerId, entryId) {
          await pause()
          for (const r of referrals)
            if (r.referrerId === referrerId && r.qualifiedAt && !r.rewardEntryId) {
              r.rewardEntryId = entryId
              undo.push(() => (r.rewardEntryId = null))
            }
        },
        async lockCustomer(customerId) {
          await pause()
          await lock(`customer:${customerId}`)
        },
        async openDebts(customerId) {
          await pause()
          return openDebtsOf(customerId)
        },
        async entriesBySource(customerId, kind, sourceRef) {
          await pause()
          return ledger
            .filter(
              (e) => e.customerId === customerId && e.kind === kind && e.sourceRef === sourceRef,
            )
            .map(copy)
        },
      }

      try {
        return await fn(tx)
      } catch (error) {
        for (const step of undo.reverse()) step()
        throw error
      } finally {
        for (const key of ownKeys) if (pendingKeys.get(key) === done) pendingKeys.delete(key)
        settle()
        for (const release of held.values()) release()
      }
    },
    async liveLots(customerId, now) {
      return ledger
        .filter(
          (e) =>
            e.customerId === customerId &&
            isLot(e) &&
            e.lotRemainingKopecks! > 0 &&
            e.expiresAt! > now,
        )
        .map((e) => ({
          id: e.id,
          remainingKopecks: e.lotRemainingKopecks!,
          expiresAt: e.expiresAt!,
        }))
    },
    async history(customerId, limit) {
      return ledger
        .filter((e) => e.customerId === customerId)
        .map((e, index) => ({ e, index }))
        .sort((a, b) => b.e.createdAt.getTime() - a.e.createdAt.getTime() || b.index - a.index)
        .slice(0, limit)
        .map(({ e }) => copy(e))
    },
    async activatedCertificates(customerId) {
      return certificates
        .filter((c) => c.status === 'activated' && c.activatedByCustomer === customerId)
        .flatMap((c) => {
          const entry = ledger.find((e) => e.idempotencyKey === `certificate:${c.id}`)
          return entry
            ? [
                {
                  serial: c.serial,
                  last4: c.last4,
                  amountKopecks: c.amountKopecks,
                  activatedAt: c.activatedAt!,
                  expiresAt: entry.expiresAt!,
                },
              ]
            : []
        })
        .sort((a, b) => b.activatedAt.getTime() - a.activatedAt.getTime())
    },
    async referralCode(customerId) {
      return referralCodes.find((r) => r.customerId === customerId)?.code ?? null
    },
    async insertReferralCode(customerId, code, at) {
      if (referralCodes.some((r) => r.customerId === customerId || r.code === code)) return
      referralCodes.push({ customerId, code, createdAt: at })
    },
    async findReferrerByCode(code) {
      return referralCodes.find((r) => r.code === code)?.customerId ?? null
    },
    async attachReferral(row) {
      if (row.referrerId === row.referredCustomerId) return false
      if (referrals.some((r) => r.referredCustomerId === row.referredCustomerId)) return false
      referrals.push(copy(row))
      return true
    },
    async qualifiedCount(referrerId) {
      return referrals.filter((r) => r.referrerId === referrerId && r.qualifiedAt).length
    },
    async debt(customerId) {
      return openDebtsOf(customerId).reduce((n, d) => n + d.outstandingKopecks, 0)
    },
    dump: () => ({
      ledger: ledger.map(copy),
      certificates: certificates.map(copy),
      referrals: referrals.map(copy),
      allocations: allocations.map(copy),
    }),
  }
}
