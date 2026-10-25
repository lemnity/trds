/**
 * Правила бонусной программы (решение заказчика 25.10.2026, PRD §5.6). Все суммы — целые копейки.
 * Значения — настройки: в production их задаёт администратор, здесь — утверждённые по умолчанию.
 */
export type LoyaltySettings = {
  /** Начисление от денежной части стоимости билетов, в сотых долях процента (300 = 3%). */
  accrualBasisPoints: number
  /** Максимальная доля стоимости билетов, оплачиваемая бонусами (3000 = 30%). */
  maxSpendBasisPoints: number
  /** Срок жизни каждого начисления, дней. */
  bonusLifetimeDays: number
  /** «Приведи 3 друга»: сколько друзей с первой покупкой дают одну награду. */
  referralGroupSize: number
  /** Награда за каждую группу друзей. */
  referralRewardKopecks: number
}

export const LOYALTY_RULES: LoyaltySettings = {
  accrualBasisPoints: 300,
  maxSpendBasisPoints: 3000,
  bonusLifetimeDays: 365,
  referralGroupSize: 3,
  referralRewardKopecks: 100_000,
}

const RUBLE = 100
const DAY_MS = 86_400_000

const assertKopecks = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer of kopecks`)
  }
}

/** Доля в сотых процента, округлённая вниз до целого рубля. */
const shareInRubles = (kopecks: number, basisPoints: number) =>
  Math.floor((kopecks * basisPoints) / 10_000 / RUBLE) * RUBLE

/**
 * Сколько бонусов начислить за оплаченные деньгами билеты. Часть, оплаченная бонусами
 * (в том числе сертификатными), и сервисный сбор в базу не входят (допущение до ответа театра).
 */
export const accrualFor = (cashForTicketsKopecks: number, settings = LOYALTY_RULES) => {
  assertKopecks(cashForTicketsKopecks, 'cashForTicketsKopecks')
  return shareInRubles(cashForTicketsKopecks, settings.accrualBasisPoints)
}

/** Сколько бонусов можно списать в заказе: не больше баланса и 30% стоимости билетов, целыми рублями. */
export const maxBonusSpend = (
  ticketsKopecks: number,
  balanceKopecks: number,
  settings = LOYALTY_RULES,
) => {
  assertKopecks(ticketsKopecks, 'ticketsKopecks')
  assertKopecks(balanceKopecks, 'balanceKopecks')
  const cap = shareInRubles(ticketsKopecks, settings.maxSpendBasisPoints)
  return Math.min(cap, Math.floor(balanceKopecks / RUBLE) * RUBLE)
}

export type BonusApplication = {
  /** Списано бонусов. */
  spentKopecks: number
  /** Сколько можно было списать максимум. */
  maxKopecks: number
  /** К оплате деньгами: билеты − бонусы + сервисный сбор. */
  cashKopecks: number
  /** Начислится после подтверждённой оплаты. */
  accrualKopecks: number
}

/**
 * Применение бонусов к заказу. Клиент присылает только желаемую сумму; она обрезается
 * до допустимой и до целых рублей — сервер никогда не доверяет присланной сумме.
 */
export const applyBonus = (
  input: {
    ticketsKopecks: number
    feeKopecks: number
    balanceKopecks: number
    requestedKopecks: number
  },
  settings = LOYALTY_RULES,
): BonusApplication => {
  assertKopecks(input.feeKopecks, 'feeKopecks')
  const maxKopecks = maxBonusSpend(input.ticketsKopecks, input.balanceKopecks, settings)
  const requested =
    Number.isSafeInteger(input.requestedKopecks) && input.requestedKopecks > 0
      ? Math.floor(input.requestedKopecks / RUBLE) * RUBLE
      : 0
  const spentKopecks = Math.min(requested, maxKopecks)
  const cashForTickets = input.ticketsKopecks - spentKopecks
  return {
    spentKopecks,
    maxKopecks,
    cashKopecks: cashForTickets + input.feeKopecks,
    accrualKopecks: accrualFor(cashForTickets, settings),
  }
}

/** Дата сгорания начисления, сделанного в момент `at`. */
export const bonusExpiresAt = (at: Date, settings = LOYALTY_RULES) =>
  new Date(at.getTime() + settings.bonusLifetimeDays * DAY_MS)

export type ReferralProgress = {
  /** Засчитано друзей в текущем круге (0…groupSize−1). */
  inRound: number
  /** Сколько друзей осталось до награды. */
  remaining: number
  /** Сколько наград уже положено за всё время. */
  rewards: number
  groupSize: number
}

/** Прогресс «Приведи 3 друга» по числу друзей с первой подтверждённой покупкой. */
export const referralProgress = (
  qualifiedFriends: number,
  settings = LOYALTY_RULES,
): ReferralProgress => {
  const friends =
    Number.isSafeInteger(qualifiedFriends) && qualifiedFriends > 0 ? qualifiedFriends : 0
  const groupSize = settings.referralGroupSize
  const inRound = friends % groupSize
  return {
    inRound,
    remaining: groupSize - inRound,
    rewards: Math.floor(friends / groupSize),
    groupSize,
  }
}

/** «Осталось ещё 2 друга» / «Остался 1 друг» — подпись индикатора. */
export const referralRemainingText = (remaining: number) => {
  const mod10 = remaining % 10
  const mod100 = remaining % 100
  if (mod10 === 1 && mod100 !== 11) return `Остался ещё ${remaining} друг`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    return `Осталось ещё ${remaining} друга`
  return `Осталось ещё ${remaining} друзей`
}

/** Остаток одного начисления в ledger. */
export type BonusLot = { id: string; remainingKopecks: number; expiresAt: Date }

/** Доступный баланс: сумма несгоревших остатков. */
export const availableBalance = (lots: readonly BonusLot[], now: Date) =>
  lots.reduce((sum, lot) => (lot.expiresAt > now ? sum + lot.remainingKopecks : sum), 0)

/**
 * Из каких начислений списать сумму: сначала те, что сгорят раньше. `null` — не хватает баланса.
 */
export const planSpend = (
  lots: readonly BonusLot[],
  amountKopecks: number,
  now: Date,
): { lotId: string; kopecks: number }[] | null => {
  assertKopecks(amountKopecks, 'amountKopecks')
  const live = lots
    .filter((lot) => lot.expiresAt > now && lot.remainingKopecks > 0)
    .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id))
  const plan: { lotId: string; kopecks: number }[] = []
  let left = amountKopecks
  for (const lot of live) {
    if (left === 0) break
    const take = Math.min(left, lot.remainingKopecks)
    plan.push({ lotId: lot.id, kopecks: take })
    left -= take
  }
  return left === 0 ? plan : null
}

/** Сколько и когда сгорит в ближайшие `days` дней (для строки «N бонусов сгорят DD.MM»). */
export const expiringSoon = (lots: readonly BonusLot[], now: Date, days = 30) => {
  const until = new Date(now.getTime() + days * DAY_MS)
  const soon = lots.filter(
    (l) => l.expiresAt > now && l.expiresAt <= until && l.remainingKopecks > 0,
  )
  if (soon.length === 0) return null
  return {
    amountKopecks: soon.reduce((sum, l) => sum + l.remainingKopecks, 0),
    earliest: new Date(Math.min(...soon.map((l) => l.expiresAt.getTime()))),
  }
}
