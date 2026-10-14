'use client'

import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

import {
  EVENT_TYPE_LABELS,
  VENUE_KIND_LABELS,
  filterPerformances,
  groupByMonth,
  type AfishaFilters,
  type EventType,
  type PerformanceView,
  type VenueKind,
} from '@/modules/shows'

import { Board } from '../board/Board'
import { EmptyState } from '../ui/EmptyState'
import styles from './AfishaBoard.module.css'

const isKind = (v: string | null): v is VenueKind => v !== null && v in VENUE_KIND_LABELS
const isType = (v: string | null): v is EventType => v !== null && v in EVENT_TYPE_LABELS

const fromParams = (params: URLSearchParams): AfishaFilters => {
  const kind = params.get('kind')
  const type = params.get('type')
  return {
    month: params.get('month') ?? undefined,
    venueKind: isKind(kind) ? kind : undefined,
    eventType: isType(type) ? type : undefined,
    kids: params.get('kids') === '1' || undefined,
    premiere: params.get('premiere') === '1' || undefined,
    pushkin: params.get('pushkin') === '1' || undefined,
    query: params.get('q') ?? undefined,
  }
}

const toParams = (f: AfishaFilters) => {
  const params = new URLSearchParams()
  if (f.month) params.set('month', f.month)
  if (f.venueKind) params.set('kind', f.venueKind)
  if (f.eventType) params.set('type', f.eventType)
  if (f.kids) params.set('kids', '1')
  if (f.premiere) params.set('premiere', '1')
  if (f.pushkin) params.set('pushkin', '1')
  if (f.query) params.set('q', f.query)
  return params
}

const SearchIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
    <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

export function AfishaBoard({ items }: { items: PerformanceView[] }) {
  const params = useSearchParams()
  const [filters, setFilters] = useState<AfishaFilters>(() => fromParams(params))

  const update = (patch: Partial<AfishaFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    const query = toParams(next).toString()
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname)
  }

  // Варианты списков — только из того, что реально есть в афише.
  const months = groupByMonth(items).map((g) => ({ key: g.key, label: g.label }))
  const kinds = [...new Set(items.map((i) => i.venue.kind))]
  const types = [...new Set(items.map((i) => i.show.eventType))]

  const visible = filterPerformances(items, filters)
  const groups = groupByMonth(visible)
  const active = Object.values(filters).some(Boolean)

  const resetAll = () =>
    update({
      month: undefined,
      venueKind: undefined,
      eventType: undefined,
      kids: undefined,
      premiere: undefined,
      pushkin: undefined,
      query: undefined,
    })

  const toggles: Array<[keyof AfishaFilters, string]> = [
    ['kids', 'Детям'],
    ['premiere', 'Премьера'],
    ['pushkin', 'Пушкинская карта'],
  ]

  return (
    <>
      <div className={styles.bar}>
        <div className={styles.filters} role="group" aria-label="Фильтры афиши">
          <label className={styles.select} data-active={Boolean(filters.month)}>
            <span className="visually-hidden">Месяц</span>
            <select
              value={filters.month ?? ''}
              onChange={(e) => update({ month: e.target.value || undefined })}
            >
              <option value="">Месяц</option>
              {months.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.select} data-active={Boolean(filters.venueKind)}>
            <span className="visually-hidden">Место проведения</span>
            <select
              value={filters.venueKind ?? ''}
              onChange={(e) =>
                update({ venueKind: isKind(e.target.value) ? e.target.value : undefined })
              }
            >
              <option value="">Место проведения</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {VENUE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.select} data-active={Boolean(filters.eventType)}>
            <span className="visually-hidden">Тип мероприятия</span>
            <select
              value={filters.eventType ?? ''}
              onChange={(e) =>
                update({ eventType: isType(e.target.value) ? e.target.value : undefined })
              }
            >
              <option value="">Тип мероприятия</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {EVENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          {toggles.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={styles.toggle}
              aria-pressed={Boolean(filters[key])}
              onClick={() => update({ [key]: filters[key] ? undefined : true })}
            >
              {label}
            </button>
          ))}
          {active && (
            <button type="button" className={styles.reset} onClick={resetAll}>
              Сбросить
            </button>
          )}
        </div>
        <label className={styles.search}>
          <span className="visually-hidden">Поиск по афише</span>
          <input
            type="search"
            placeholder="Поиск по афише"
            value={filters.query ?? ''}
            onChange={(e) => update({ query: e.target.value || undefined })}
          />
          <SearchIcon />
        </label>
      </div>

      <p className="visually-hidden" aria-live="polite">
        Найдено показов: {visible.length}
      </p>

      {groups.length === 0 ? (
        <EmptyState title="Ничего не нашлось">
          <p>
            {filters.pushkin
              ? 'Сведения о спектаклях по Пушкинской карте театр ещё не передал.'
              : filters.kids
                ? 'Сейчас в афише нет спектаклей для детей.'
                : 'Попробуйте изменить фильтры или поиск.'}{' '}
            <button type="button" className={styles.resetInline} onClick={resetAll}>
              Показать всю афишу
            </button>
          </p>
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
