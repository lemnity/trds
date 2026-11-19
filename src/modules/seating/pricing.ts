import { SEAT_ZONE_IDS, applySeatLayout, layoutOf, type SeatLayout } from './layout'
import { seatsOf } from './quote'
import { getZonePlan } from './registry'
import type { SeatingPlan } from './types'
import type { ZonePlan } from './zone-plans'

/**
 * Цены мест в CMS — одно JSON-поле (показ: `seating.pricing`, шаблон площадки: `pricing`).
 * Его пишет редактор «Схема зала» в админке: ценовые зоны и к какой зоне относится каждое место.
 *
 *   { zones: [{ categoryId: 'cat-1', title: 'Партер', priceKopecks: 150000 }],
 *     seats: { 'r1-s1': 'cat-1', … } }
 *
 * Зона без цены (null) не продаётся. Места, которых нет в `seats`, — в категории схемы.
 */
export type SeatPricingZone = {
  categoryId: string
  title: string
  priceKopecks: number | null
  /** Только зонные схемы: сколько билетов в зоне (без мест). Пусто — зона не продаётся. */
  capacity?: number | null
  /** Свой цвет зоны «#rrggbb»; пусто — цвет схемы (или палитры зон). */
  color?: string | null
}
export type SeatPricing = { zones: SeatPricingZone[]; seats: Record<string, string> }

export type SeatPricingError =
  | 'NOT_AN_OBJECT'
  | 'BAD_ZONE'
  | 'DUPLICATE_ZONE'
  | 'BAD_PRICE'
  | 'BAD_CAPACITY'
  | 'BAD_COLOR'
  | 'EMPTY_TITLE'
  | 'BAD_SEAT_ZONE'

export const SEAT_PRICING_ERRORS: Record<SeatPricingError, string> = {
  NOT_AN_OBJECT: 'Цены мест: неверный формат данных',
  BAD_ZONE: 'Цены мест: неизвестная ценовая зона',
  DUPLICATE_ZONE: 'Цены мест: зона указана дважды',
  BAD_PRICE: 'Цена зоны — целое число копеек не меньше нуля',
  BAD_CAPACITY: 'Вместимость зоны — целое число билетов не меньше нуля',
  BAD_COLOR: 'Цвет зоны — в формате #rrggbb',
  EMPTY_TITLE: 'У каждой ценовой зоны должно быть название',
  BAD_SEAT_ZONE: 'Место отнесено к зоне, которой нет в списке',
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/**
 * Разбор и проверка JSON из CMS. Пусто (null) — цены не заданы, это не ошибка. Зоны — по схеме
 * `planId`: у зонной схемы — её зоны (с вместимостью), иначе «cat-1»…«cat-12».
 */
export const parseSeatPricing = (
  value: unknown,
  planId?: string | null,
): { ok: true; pricing: SeatPricing | null } | { ok: false; error: SeatPricingError } => {
  if (value === null || value === undefined) return { ok: true, pricing: null }
  if (!isRecord(value) || !Array.isArray(value.zones) || !isRecord(value.seats ?? {}))
    return { ok: false, error: 'NOT_AN_OBJECT' }

  const zonePlan = planId ? getZonePlan(planId) : null
  const allowed = zonePlan ? zonePlan.zones.map((z) => z.id) : SEAT_ZONE_IDS
  const zones: SeatPricingZone[] = []
  for (const raw of value.zones) {
    if (!isRecord(raw) || typeof raw.categoryId !== 'string' || !allowed.includes(raw.categoryId))
      return { ok: false, error: 'BAD_ZONE' }
    if (zones.some((z) => z.categoryId === raw.categoryId))
      return { ok: false, error: 'DUPLICATE_ZONE' }
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    if (!title) return { ok: false, error: 'EMPTY_TITLE' }
    const price = raw.priceKopecks ?? null
    if (price !== null && !(typeof price === 'number' && Number.isSafeInteger(price) && price >= 0))
      return { ok: false, error: 'BAD_PRICE' }
    const capacity = raw.capacity ?? null
    if (capacity !== null && !isCount(capacity)) return { ok: false, error: 'BAD_CAPACITY' }
    const color = raw.color ?? null
    if (color !== null && !(typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)))
      return { ok: false, error: 'BAD_COLOR' }
    zones.push({
      categoryId: raw.categoryId,
      title,
      priceKopecks: price,
      ...(zonePlan && { capacity }),
      ...(color && { color: color.toLowerCase() }),
    })
  }
  if (zonePlan) return { ok: true, pricing: { zones, seats: {} } }

  const ids = new Set(zones.map((z) => z.categoryId))
  const seats: Record<string, string> = {}
  for (const [seatId, zone] of Object.entries((value.seats ?? {}) as Record<string, unknown>)) {
    if (typeof zone !== 'string' || !ids.has(zone)) return { ok: false, error: 'BAD_SEAT_ZONE' }
    seats[seatId] = zone
  }
  return { ok: true, pricing: { zones, seats } }
}

/** Валидатор поля Payload. */
export const validateSeatPricing = (value: unknown, planId?: string | null): true | string => {
  const parsed = parseSeatPricing(value, planId)
  return parsed.ok ? true : SEAT_PRICING_ERRORS[parsed.error]
}

/** Цены по зонам — то, что продаёт витрина (зоны без цены не продаются). */
export const pricesOf = (pricing: SeatPricing | null): Record<string, number> =>
  Object.fromEntries(
    (pricing?.zones ?? [])
      .filter((z) => z.priceKopecks !== null)
      .map((z) => [z.categoryId, z.priceKopecks!]),
  )

export const layoutOfPricing = (pricing: SeatPricing | null): SeatLayout | undefined =>
  pricing && (pricing.zones.length > 0 || Object.keys(pricing.seats).length > 0)
    ? {
        categories: pricing.zones.map((z) => ({
          id: z.categoryId,
          title: z.title,
          ...(z.color && { color: z.color }),
        })),
        seatCategories: pricing.seats,
      }
    : undefined

/**
 * Полные цены для редактора: каждое место схемы отнесено к зоне. Пустые цены — категории схемы
 * «по рядам» без цен. Зоны без мест сохраняются (их можно «раскидать» позже).
 */
export const completePricing = (plan: SeatingPlan, pricing: SeatPricing | null): SeatPricing => {
  const effective = applySeatLayout(plan, layoutOfPricing(pricing))
  const priceOf = new Map((pricing?.zones ?? []).map((z) => [z.categoryId, z.priceKopecks]))
  const zones = [
    ...(pricing?.zones ?? []),
    ...effective.categories
      .filter((c) => !priceOf.has(c.id))
      .map((c) => ({ categoryId: c.id, title: c.title, priceKopecks: null })),
  ]
  return { zones, seats: layoutOf(effective).seatCategories }
}

/** Сводка по зонам: сколько мест и выручка при полной продаже (без закрытых мест). */
export const pricingSummary = (
  plan: SeatingPlan,
  pricing: SeatPricing,
  closedSeatIds: readonly string[] = [],
) => {
  const closed = new Set(closedSeatIds)
  const counts = new Map<string, number>()
  const closedCounts = new Map<string, number>()
  for (const seat of seatsOf(plan)) {
    const zone = pricing.seats[seat.id] ?? seat.categoryId
    const target = closed.has(seat.id) ? closedCounts : counts
    target.set(zone, (target.get(zone) ?? 0) + 1)
  }
  const zones = pricing.zones.map((z) => ({
    ...z,
    seats: counts.get(z.categoryId) ?? 0,
    closed: closedCounts.get(z.categoryId) ?? 0,
  }))
  return {
    zones,
    onSale: zones.filter((z) => z.priceKopecks !== null).reduce((n, z) => n + z.seats, 0),
    unpriced: zones.filter((z) => z.priceKopecks === null).reduce((n, z) => n + z.seats, 0),
    closed: closed.size,
    revenueKopecks: zones.reduce((sum, z) => sum + (z.priceKopecks ?? 0) * z.seats, 0),
  }
}

/** Цены зонной схемы для редактора: все зоны схемы в её порядке, без цены — пусто. */
export const completeZonePricing = (plan: ZonePlan, pricing: SeatPricing | null): SeatPricing => {
  const byId = new Map((pricing?.zones ?? []).map((z) => [z.categoryId, z]))
  return {
    zones: plan.zones.map((zone) => {
      const set = byId.get(zone.id)
      return {
        categoryId: zone.id,
        title: set?.title ?? zone.title,
        priceKopecks: set?.priceKopecks ?? null,
        capacity: set?.capacity ?? null,
        ...(set?.color && { color: set.color }),
      }
    }),
    seats: {},
  }
}

/**
 * Зоны → категории билетов показа (ключ — id зоны). Продаются зоны с ценой и вместимостью;
 * у остальных вместимость 0 — inventory держит категорию, но билетов в ней нет.
 */
export const zoneTicketTypes = (
  plan: ZonePlan,
  pricing: SeatPricing | null,
  placeholder = false,
): { id: string; title: string; priceKopecks: number; capacity: number; placeholder?: true }[] =>
  completeZonePricing(plan, pricing)
    .zones.filter((z) => z.priceKopecks !== null)
    .map((z) => ({
      id: z.categoryId,
      title: z.title,
      priceKopecks: z.priceKopecks!,
      capacity: z.capacity ?? 0,
      ...(placeholder && { placeholder: true as const }),
    }))

/** Цвета зон показа, заданные в админке поверх цветов схемы. */
export const zoneColorsOf = (pricing: SeatPricing | null): Record<string, string> =>
  Object.fromEntries(
    (pricing?.zones ?? []).filter((z) => z.color).map((z) => [z.categoryId, z.color!]),
  )

/** Схема с цветами показа (для сайта). */
export const withZoneColors = (
  plan: ZonePlan,
  colors: Record<string, string> | undefined,
): ZonePlan =>
  colors && Object.keys(colors).length
    ? { ...plan, zones: plan.zones.map((z) => ({ ...z, color: colors[z.id] ?? z.color })) }
    : plan
