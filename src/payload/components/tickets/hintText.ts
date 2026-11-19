import { hallOf } from '../seating/hall'

const NO_PLAN =
  'Нужны, только если продажа без схемы зала (входные билеты). Для залов со схемой цены задаются выше, на схеме.'
const ZONE_PLAN = 'Зоны схемы продаются как категории автоматически.'

/** Пояснение к блоку «Билеты (категории)» в зависимости от выбранной схемы зала. */
export function categoriesHint(planId: string | null | undefined): string {
  const hall = planId ? hallOf(planId) : null
  if (hall?.kind === 'zones') return ZONE_PLAN
  return NO_PLAN
}
