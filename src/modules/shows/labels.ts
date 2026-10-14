import type { EventType, VenueKind } from './types'

// Формат площадки — главное отличие театра: спектакли идут вне классической сцены.
export const VENUE_KIND_LABELS: Record<VenueKind, string> = {
  bar: 'Бар',
  restaurant: 'Ресторан',
  loft: 'Лофт',
  apartment: 'Квартира',
  stage: 'Сцена',
  city: 'Город',
}

export const formatDuration = (minutes: number | null): string | null => {
  if (minutes === null) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} мин`
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`
}

export const formatAge = (age: number | null): string | null => (age === null ? null : `${age}+`)

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  spectacle: 'Спектакль',
  immersive: 'Иммерсивный спектакль',
  performance: 'Перформанс',
  concert: 'Концерт, кабаре',
  promenade: 'Спектакль-променад',
}
