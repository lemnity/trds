/**
 * Правила возврата по заявке зрителя (ст. 52.1 Закона «Основы законодательства РФ о культуре»,
 * Постановление Правительства РФ № 1491 от 18.09.2020). Чистые функции: подсказка суммы для
 * зрителя до подачи и для сотрудника при решении. Решение по любой заявке принимает сотрудник
 * (очередь в админке) — система только считает, что положено по закону.
 *
 *  • больше 10 дней до спектакля — 100% номинала;
 *  • от 5 до 10 дней — не меньше 50% (театр может поднять в настройках);
 *  • от 3 до 5 дней — не меньше 30% (театр может поднять в настройках);
 *  • меньше 3 дней — только при болезни зрителя или смерти близкого родственника, с документом;
 *  • акционные билеты не возвращаются, кроме переноса/отмены/замены, болезни или смерти близкого;
 *  • документ можно прислать в течение 14 дней после спектакля, но заявка — не позже дня спектакля.
 *
 * Номинал — цена билета без сервисного сбора; сбор возвращается только при отмене/переносе/замене.
 */

export const CLAIM_REASONS = [
  'CHANGED_MIND',
  'ILLNESS',
  'RELATIVE_DEATH',
  'EVENT_CHANGED',
  'OTHER',
] as const
export type ClaimReason = (typeof CLAIM_REASONS)[number]

export const CLAIM_REASON_LABELS: Record<ClaimReason, string> = {
  CHANGED_MIND: 'Не смогу пойти / передумал',
  ILLNESS: 'Болезнь',
  RELATIVE_DEATH: 'Смерть близкого родственника',
  EVENT_CHANGED: 'Спектакль перенесён, отменён или заменён',
  OTHER: 'Другая причина',
}

/** Причины, для которых нужен подтверждающий документ. */
export const DOCUMENT_REASONS: ReadonlySet<ClaimReason> = new Set(['ILLNESS', 'RELATIVE_DEATH'])

/** Проценты по срокам; 100% за 10+ дней задаёт закон, его не меняют. */
export type ClaimTiers = {
  /** От 5 до 10 дней: не меньше 50. */
  halfPercent: number
  /** От 3 до 5 дней: не меньше 30. */
  lowPercent: number
}

export const LEGAL_MIN_TIERS: ClaimTiers = { halfPercent: 50, lowPercent: 30 }

const DAY_MS = 24 * 60 * 60_000
export const DOCUMENT_DAYS_AFTER = 14

/** Почему по закону положено столько. */
export type ClaimBasis =
  | 'MORE_THAN_10_DAYS'
  | 'FROM_5_TO_10_DAYS'
  | 'FROM_3_TO_5_DAYS'
  | 'LESS_THAN_3_DAYS'
  | 'PROMO'
  | 'DOCUMENTED'
  | 'EVENT_CHANGED'

export const CLAIM_BASIS_TEXT: Record<ClaimBasis, string> = {
  MORE_THAN_10_DAYS: 'Больше 10 дней до спектакля — возвращается 100% стоимости билета.',
  FROM_5_TO_10_DAYS: 'От 5 до 10 дней до спектакля — возвращается часть стоимости билета.',
  FROM_3_TO_5_DAYS: 'От 3 до 5 дней до спектакля — возвращается часть стоимости билета.',
  LESS_THAN_3_DAYS:
    'Меньше 3 дней до спектакля — по закону деньги возвращаются только при болезни зрителя или смерти близкого родственника, с подтверждающим документом. Билет можно передать другому человеку.',
  PROMO:
    'Акционные билеты не возвращаются — кроме переноса, отмены или замены спектакля, болезни зрителя или смерти близкого родственника.',
  DOCUMENTED:
    'При болезни или смерти близкого возвращается 100% стоимости билета после проверки подтверждающего документа.',
  EVENT_CHANGED:
    'Спектакль перенесён, отменён или заменён — возвращается полная стоимость, включая сервисный сбор.',
}

export type ClaimAssessment = {
  /** Можно ли подать заявку сейчас (не позже дня спектакля). */
  canSubmit: boolean
  /** Сколько процентов номинала положено по закону и настройкам театра (0 — не положено). */
  percent: number
  basis: ClaimBasis
  /** Возвращать ли сервисный сбор (только перенос/отмена/замена). */
  includeFee: boolean
  documentRequired: boolean
  /** До какого момента можно прислать документ (конец 14-го дня после спектакля). */
  documentDeadline: Date | null
  /** Конец дня спектакля по времени театра — крайний срок подачи заявки. */
  submitDeadline: Date
}

/** Сдвиг часового пояса театра на дату (Asia/Yekaterinburg — без перехода на летнее время). */
const zoneOffsetMs = (at: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

/** Последний миг календарного дня `at` по времени театра. */
export const endOfTheatreDay = (at: Date, timeZone: string) => {
  const offset = zoneOffsetMs(at, timeZone)
  const local = new Date(at.getTime() + offset)
  const end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - 1
  return new Date(end - offset)
}

/**
 * Что положено зрителю по заявке. `startsAt` — начало спектакля; `promo` — среди билетов есть
 * акционный (тогда правило акции действует на всю заявку).
 */
export function assessClaim({
  startsAt,
  now,
  reason,
  promo,
  tiers,
  timeZone,
}: {
  startsAt: Date
  now: Date
  reason: ClaimReason
  promo: boolean
  tiers: ClaimTiers
  timeZone: string
}): ClaimAssessment {
  const submitDeadline = endOfTheatreDay(startsAt, timeZone)
  const canSubmit = now.getTime() <= submitDeadline.getTime()
  const base = { canSubmit, submitDeadline, includeFee: false, documentRequired: false }

  if (reason === 'EVENT_CHANGED')
    return {
      ...base,
      percent: 100,
      basis: 'EVENT_CHANGED',
      includeFee: true,
      documentDeadline: null,
    }

  if (DOCUMENT_REASONS.has(reason))
    return {
      ...base,
      percent: 100,
      basis: 'DOCUMENTED',
      documentRequired: true,
      documentDeadline: new Date(submitDeadline.getTime() + DOCUMENT_DAYS_AFTER * DAY_MS),
    }

  if (promo) return { ...base, percent: 0, basis: 'PROMO', documentDeadline: null }

  const left = startsAt.getTime() - now.getTime()
  if (left > 10 * DAY_MS)
    return { ...base, percent: 100, basis: 'MORE_THAN_10_DAYS', documentDeadline: null }
  if (left >= 5 * DAY_MS)
    return {
      ...base,
      percent: tiers.halfPercent,
      basis: 'FROM_5_TO_10_DAYS',
      documentDeadline: null,
    }
  if (left >= 3 * DAY_MS)
    return { ...base, percent: tiers.lowPercent, basis: 'FROM_3_TO_5_DAYS', documentDeadline: null }
  return { ...base, percent: 0, basis: 'LESS_THAN_3_DAYS', documentDeadline: null }
}
