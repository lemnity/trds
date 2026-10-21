'use client'

import { Button, ListBox, SearchField, Select, ToggleButton } from '@heroui/react'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'

import {
  AUDIENCES,
  EVENT_TYPE_LABELS,
  VENUE_KIND_LABELS,
  filterPerformances,
  groupByMonth,
  type AfishaFilters,
  type Audience,
  type EventType,
  type PerformanceView,
  type VenueKind,
} from '@/modules/shows'

import { Board } from '../board/Board'
import { EmptyState } from '../ui/EmptyState'
import styles from './AfishaBoard.module.css'

const isKind = (v: string | null): v is VenueKind => v !== null && v in VENUE_KIND_LABELS
const isType = (v: string | null): v is EventType => v !== null && v in EVENT_TYPE_LABELS
const isAudience = (v: string | null): v is Audience => AUDIENCES.some((a) => a.id === v)

const fromParams = (params: URLSearchParams): AfishaFilters => {
  const kind = params.get('kind')
  const type = params.get('type')
  // ?for=youth; старые ссылки ?kids=1 — тоже «Детям».
  const audience = params.get('for') ?? (params.get('kids') === '1' ? 'kids' : null)
  return {
    month: params.get('month') ?? undefined,
    venueKind: isKind(kind) ? kind : undefined,
    eventType: isType(type) ? type : undefined,
    audience: isAudience(audience) ? audience : undefined,
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
  if (f.audience) params.set('for', f.audience)
  if (f.premiere) params.set('premiere', '1')
  if (f.pushkin) params.set('pushkin', '1')
  if (f.query) params.set('q', f.query)
  return params
}

const ALL = '__all'

type Option<K extends string> = { id: K; label: string }

/** Выпадающий фильтр (HeroUI Select): первый пункт «Все» снимает фильтр. */
function FilterSelect<K extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: K | undefined
  options: Array<Option<K>>
  onChange: (value: K | undefined) => void
}) {
  const ids = new Set<string>(options.map((o) => o.id))
  return (
    <Select
      aria-label={label}
      placeholder={label}
      value={value ?? null}
      onChange={(key) => onChange(typeof key === 'string' && ids.has(key) ? (key as K) : undefined)}
      className={styles.select}
    >
      <Select.Trigger className={value ? `${styles.pill} ${styles.active}` : styles.pill}>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id={ALL} textValue={`${label}: все`}>
            Все
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {options.map((o) => (
            <ListBox.Item key={o.id} id={o.id} textValue={o.label}>
              {o.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}

export function AfishaBoard({ items }: { items: PerformanceView[] }) {
  const params = useSearchParams()
  const [filters, setFilters] = useState<AfishaFilters>(() => fromParams(params))
  // Переход по ссылке на ту же афишу с другим фильтром (подменю шапки) меняет только
  // параметры адреса — подхватываем их (паттерн «состояние от предыдущего значения»).
  const query = params.toString()
  const [seenQuery, setSeenQuery] = useState(query)
  if (query !== seenQuery) {
    setSeenQuery(query)
    setFilters(fromParams(params))
  }

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
      audience: undefined,
      premiere: undefined,
      pushkin: undefined,
      query: undefined,
    })

  const toggles: Array<[keyof AfishaFilters, string]> = [
    ['premiere', 'Премьера'],
    ['pushkin', 'Пушкинская карта'],
  ]

  return (
    <>
      <div className={styles.bar}>
        <div className={styles.filters} role="group" aria-label="Фильтры афиши">
          <FilterSelect
            label="Месяц"
            value={filters.month}
            options={months.map((m) => ({ id: m.key, label: m.label }))}
            onChange={(month) => update({ month })}
          />
          <FilterSelect
            label="Место проведения"
            value={filters.venueKind}
            options={kinds.map((k) => ({ id: k, label: VENUE_KIND_LABELS[k] }))}
            onChange={(venueKind) => update({ venueKind })}
          />
          <FilterSelect
            label="Тип мероприятия"
            value={filters.eventType}
            options={types.map((t) => ({ id: t, label: EVENT_TYPE_LABELS[t] }))}
            onChange={(eventType) => update({ eventType })}
          />
          <FilterSelect
            label="Для кого"
            value={filters.audience}
            options={AUDIENCES.map((a) => ({ id: a.id, label: a.label }))}
            onChange={(audience) => update({ audience })}
          />
          {toggles.map(([key, label]) => (
            <ToggleButton
              key={key}
              className={styles.pill}
              isSelected={Boolean(filters[key])}
              onChange={(on) => update({ [key]: on || undefined })}
            >
              {label}
            </ToggleButton>
          ))}
          {active && (
            <Button variant="ghost" onPress={resetAll}>
              Сбросить
            </Button>
          )}
        </div>
        <SearchField
          aria-label="Поиск по афише"
          value={filters.query ?? ''}
          onChange={(query) => update({ query: query || undefined })}
          className={styles.search}
        >
          <SearchField.Group className={styles.pill}>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Поиск по афише" />
            <SearchField.ClearButton aria-label="Очистить поиск" />
          </SearchField.Group>
        </SearchField>
      </div>

      <p className="visually-hidden" aria-live="polite">
        Найдено показов: {visible.length}
      </p>

      {groups.length === 0 ? (
        <EmptyState title="Ничего не нашлось">
          <p>
            {filters.pushkin
              ? 'Сведения о спектаклях по Пушкинской карте театр ещё не передал.'
              : filters.audience === 'students'
                ? 'Театр ещё не передал, на какие спектакли действуют студенческие условия.'
                : filters.audience
                  ? `Сейчас в афише нет спектаклей в категории «${AUDIENCES.find((a) => a.id === filters.audience)?.label}».`
                  : 'Попробуйте изменить фильтры или поиск.'}{' '}
            <Button variant="tertiary" onPress={resetAll} className={styles.resetInline}>
              Показать всю афишу
            </Button>
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
