import { Meter } from '@heroui/react'

import { availabilityText, type Availability as AvailabilityData } from '@/modules/shows'

import styles from './Availability.module.css'

const COLOR = { many: 'success', few: 'warning', none: 'danger' } as const

/**
 * Индикатор остатка: Meter HeroUI (доля свободных мест) и подпись. Цвет дублируется
 * текстом — не единственный признак (WCAG 1.4.1).
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
  const text = availabilityText(availability)
  return (
    <span
      className={`${styles.indicator} ${tone === 'dark' ? styles.dark : ''}`}
      data-level={level}
    >
      {availability && (
        <Meter
          aria-label={text}
          size="sm"
          color={COLOR[availability.level]}
          value={availability.available}
          maxValue={Math.max(availability.capacity, 1)}
          className={styles.meter}
        >
          <Meter.Track>
            <Meter.Fill />
          </Meter.Track>
        </Meter>
      )}
      <span className={styles.text}>{text}</span>
    </span>
  )
}
