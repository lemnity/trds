import { domAkteraPlan, domKulturyPlan } from './dom-aktera'
import type { SeatingPlan } from './types'

// Утверждённые схемы залов. Площадки без схемы продают билеты по категориям.
const PLANS: Record<string, SeatingPlan> = {
  [domAkteraPlan.id]: domAkteraPlan,
  [domKulturyPlan.id]: domKulturyPlan,
}

export const getSeatingPlan = (id: string): SeatingPlan | null => PLANS[id] ?? null
