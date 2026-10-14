import { availabilityText, type Availability as AvailabilityData } from '@/modules/shows'

import styles from './Availability.module.css'

/**
 * Индикатор остатка: полоса (доля свободных мест) и подпись. Цвет дублируется текстом,
 * поэтому не единственный признак (WCAG 1.4.1).
 */
export function Availability({
  availability,
  tone = 'light',
}: {
  availability: AvailabilityData | null
  /** dark — на тёмном/брендовом фоне (выбранная карточка даты). */
  tone?: 'light' | 'dark'
}) {
  const level = availability?.level ?? 'closed'
  const share = availability ? availability.available / Math.max(availability.capacity, 1) : 0
  return (
    <span
      className={`${styles.indicator} ${tone === 'dark' ? styles.dark : ''}`}
      data-level={level}
    >
      {availability && (
        <span className={styles.bar} aria-hidden="true">
          <span style={{ width: `${Math.round(share * 100)}%` }} />
        </span>
      )}
      <span className={styles.text}>{availabilityText(availability)}</span>
    </span>
  )
}
