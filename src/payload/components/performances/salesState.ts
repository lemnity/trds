import { getZonePlan, parseSeatPricing, pricesOf, zoneTicketTypes } from '@/modules/seating'

/**
 * Состояние продаж показа для админки — по тем же правилам, что сайт, чтобы админка и витрина
 * не расходились:
 * - цены: `src/modules/shows/cms.ts` `performanceFromCms` (категории билетов, кроме совпавших по
 *   коду с зонами; зоны зонной схемы через `zoneTicketTypes`; цены мест через `pricesOf`, только
 *   у схемы с местами; битый JSON цен — «цен нет») и `src/modules/shows/queries.ts` `toView`
 *   (`salesOpen = prices.length > 0 && inSalesWindow`);
 * - окно продаж: `queries.ts` `inSalesWindow` (начало ≤ сейчас < конец; пусто — без границы);
 * - прошедший показ: `queries.ts` `isUpcoming` (начался — уже не продаётся).
 * Отличие: зона зонной схемы считается ценой, только если у неё есть и вместимость (> 0) —
 * сайт показал бы её «в продаже», но билетов в ней нет.
 *
 * Возвращает факты (цены, окно, прошёл ли показ) и итоговый статус строки — факты пригодятся
 * панели готовности к продаже.
 */

export type SalesPerformance = {
  startsAt: string
  salesStartAt?: string | null
  salesEndAt?: string | null
  seating?: { planId?: string | null; pricing?: unknown } | null
}

/** Категория билетов показа: важен только код (совпавшие с зоной заменяются зоной). */
export type SalesTicketType = { code: string }

export type SalesWindow =
  { state: 'notYet'; opensAt: string } | { state: 'open' } | { state: 'ended' }

export type SalesStatus =
  | { kind: 'open' }
  | { kind: 'opensLater'; opensAt: string }
  | { kind: 'noPrices' }
  | { kind: 'closed' }

export type SalesState = {
  hasPrices: boolean
  window: SalesWindow
  isPast: boolean
  status: SalesStatus
}

const hasPricesOf = (perf: SalesPerformance, ticketTypes: readonly SalesTicketType[]) => {
  const planId = perf.seating?.planId ?? null
  const parsed = parseSeatPricing(perf.seating?.pricing ?? null, planId)
  const pricing = parsed.ok ? parsed.pricing : null
  const zonePlan = planId ? getZonePlan(planId) : null
  const zoneTypes = zonePlan ? zoneTicketTypes(zonePlan, pricing) : []
  const zoneIds = new Set(zoneTypes.map((t) => t.id))
  if (ticketTypes.some((t) => !zoneIds.has(t.code))) return true
  if (zoneTypes.some((t) => t.capacity > 0)) return true
  return !!planId && !zonePlan && Object.keys(pricesOf(pricing)).length > 0
}

const windowOf = (perf: SalesPerformance, now: number): SalesWindow => {
  if (perf.salesEndAt && Date.parse(perf.salesEndAt) <= now) return { state: 'ended' }
  if (perf.salesStartAt && Date.parse(perf.salesStartAt) > now)
    return { state: 'notYet', opensAt: perf.salesStartAt }
  return { state: 'open' }
}

const statusOf = (facts: Omit<SalesState, 'status'>): SalesStatus => {
  if (facts.isPast || facts.window.state === 'ended') return { kind: 'closed' }
  if (!facts.hasPrices) return { kind: 'noPrices' }
  if (facts.window.state === 'notYet') return { kind: 'opensLater', opensAt: facts.window.opensAt }
  return { kind: 'open' }
}

export const performanceSalesState = (
  perf: SalesPerformance,
  ticketTypes: readonly SalesTicketType[],
  now: Date,
): SalesState => {
  const facts = {
    hasPrices: hasPricesOf(perf, ticketTypes),
    window: windowOf(perf, now.getTime()),
    isPast: Date.parse(perf.startsAt) <= now.getTime(),
  }
  return { ...facts, status: statusOf(facts) }
}
