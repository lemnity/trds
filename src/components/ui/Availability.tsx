import type { Availability as AvailabilityData } from '@/modules/shows'

import styles from './Availability.module.css'

const ticketsWord = (n: number) =>
  n % 10 === 1 && n % 100 !== 11
    ? 'билет'
    : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)
      ? 'билета'
      : 'билетов'

export const availabilityText = (a: AvailabilityData | null): string => {
  if (!a) return 'Продажа на сайте не открыта'
  if (a.level === 'none') return 'Билетов нет'
  if (a.level === 'few') return `Осталось ${a.available} ${ticketsWord(a.available)}`
  return 'Билеты есть'
}

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
