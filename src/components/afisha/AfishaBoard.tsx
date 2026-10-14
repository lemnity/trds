'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

import {
  groupByMonth,
  VENUE_KIND_LABELS,
  type PerformanceView,
  type VenueKind,
} from '@/modules/shows'

import { Board } from '../board/Board'
import { EmptyState } from '../ui/EmptyState'
import styles from './AfishaBoard.module.css'

const isKind = (value: string | null): value is VenueKind =>
  value !== null && value in VENUE_KIND_LABELS

export function AfishaBoard({ items }: { items: PerformanceView[] }) {
  const params = useSearchParams()
  const initial = params.get('kind')
  const [kind, setKind] = useState<VenueKind | null>(isKind(initial) ? initial : null)

  const kinds = [...new Set(items.map((i) => i.venue.kind))]
  const visible = kind ? items.filter((i) => i.venue.kind === kind) : items
  const groups = groupByMonth(visible)

  const select = (next: VenueKind | null) => {
    setKind(next)
    const url = new URL(window.location.href)
    if (next) url.searchParams.set('kind', next)
    else url.searchParams.delete('kind')
    window.history.replaceState(null, '', url)
  }

  return (
    <>
      <div className={styles.filters} role="group" aria-label="Формат площадки">
        <button type="button" aria-pressed={kind === null} onClick={() => select(null)}>
          Все
        </button>
        {kinds.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => select(k)}>
            {VENUE_KIND_LABELS[k]}
          </button>
        ))}
      </div>

      <p className="visually-hidden" aria-live="polite">
        Показов: {visible.length}
      </p>

      {groups.length === 0 ? (
        <EmptyState title="Ближайших показов нет">
          {kind ? (
            <p>
              В формате «{VENUE_KIND_LABELS[kind]}» ближайших показов нет.{' '}
              <button type="button" className={styles.reset} onClick={() => select(null)}>
                Показать все
              </button>
            </p>
          ) : (
            <p>Новые даты появятся здесь, как только театр откроет их.</p>
          )}
        </EmptyState>
      ) : (
        groups.map((group) => (
          <section key={group.key} className={styles.month} aria-labelledby={`m-${group.key}`}>
            <h2 id={`m-${group.key}`} className={styles.monthTitle}>
              {group.label}
            </h2>
            <Board items={group.items} label={`Показы: ${group.label}`} />
          </section>
        ))
      )}
    </>
  )
}
