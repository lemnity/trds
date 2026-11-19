import { domAkteraPlan, domKulturyPlan } from './dom-aktera'
import type { SeatingPlan } from './types'
import { khlebozavodPlan, type ZonePlan } from './zone-plans'

// Утверждённые схемы залов. Площадки без схемы продают билеты по категориям.
/** Схемы с нумерованными местами. */
export const SEATING_PLANS: readonly SeatingPlan[] = [domAkteraPlan, domKulturyPlan]
/** Зонные схемы: зоны без мест, каждая — категория билетов с ценой и вместимостью. */
export const ZONE_PLANS: readonly ZonePlan[] = [khlebozavodPlan]

const PLANS: Record<string, SeatingPlan> = Object.fromEntries(SEATING_PLANS.map((p) => [p.id, p]))
const ZONES: Record<string, ZonePlan> = Object.fromEntries(ZONE_PLANS.map((p) => [p.id, p]))

export const getSeatingPlan = (id: string): SeatingPlan | null => PLANS[id] ?? null
export const getZonePlan = (id: string): ZonePlan | null => ZONES[id] ?? null

/** Все схемы для выбора в админке (значение select-полей «Схема зала»). */
export const HALL_PLAN_OPTIONS = [
  ...SEATING_PLANS.map((p) => ({ value: p.id, label: `${p.title} (места)` })),
  ...ZONE_PLANS.map((p) => ({ value: p.id, label: `${p.title} (зоны)` })),
]
