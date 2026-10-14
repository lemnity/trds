'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useId, useState, useSyncExternalStore } from 'react'

import { formatRub } from '@/lib/money'
import {
  MAX_TICKETS_PER_ORDER,
  quoteOrder,
  remainingOf,
  selectionToSearch,
} from '@/modules/checkout'
import { quoteSeats } from '@/modules/seating'
import {
  availabilityLevel,
  formatPerformanceDate,
  type Availability,
  type SalePerformance,
  type TicketType,
} from '@/modules/shows'

import buttons from '../ui/button.module.css'
import { Availability as AvailabilityIndicator } from '../ui/Availability'
import { VenueTag } from '../ui/VenueTag'
import { SeatMap } from './SeatMap'
import styles from './ShowBooking.module.css'

type Props = {
  performances: SalePerformance[]
  /** Страница спектакля на текущем сайте театра (продажи через Ticketscloud). */
  fallbackUrl: string
}

type Day = { key: string; items: SalePerformance[] }

const noopSubscribe = () => () => {}

const groupByDay = (items: SalePerformance[]): Day[] => {
  const days = new Map<string, Day>()
  for (const item of items) {
    const d = formatPerformanceDate(item.startsAt)
    const key = `${d.monthKey}-${d.day}`
    const day = days.get(key) ?? { key, items: [] }
    day.items.push(item)
    days.set(key, day)
  }
  return [...days.values()]
}

const daysWord = (n: number) =>
  n % 10 === 1 && n % 100 !== 11
    ? 'дата'
    : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)
      ? 'даты'
      : 'дат'

/** Остаток дня: сумма по сеансам с открытой продажей; нет таких — неизвестен. */
const dayAvailability = (items: SalePerformance[]): Availability | null => {
  const known = items.flatMap((p) => (p.availability ? [p.availability] : []))
  if (known.length === 0) return null
  const available = known.reduce((sum, a) => sum + a.available, 0)
  const capacity = known.reduce((sum, a) => sum + a.capacity, 0)
  return { available, capacity, level: availabilityLevel(available, capacity) }
}

const initialQuantities = (types: TicketType[]) =>
  // Первая категория с остатком — 1 билет; распроданные — 0.
  Object.fromEntries(types.map((t) => [t.id, t === types.find((x) => remainingOf(x) > 0) ? 1 : 0]))

export function ShowBooking({ performances, fallbackUrl }: Props) {
  const ids = useId()
  const params = useSearchParams()

  // Страница собрана заранее: начавшиеся показы убираем уже в браузере (WEB-02, TICKETS-01).
  const startedKey = useSyncExternalStore(
    noopSubscribe,
    () =>
      performances
        .filter((p) => Date.parse(p.startsAt) <= Date.now())
        .map((p) => p.id)
        .join(','),
    () => '',
  )
  const started = new Set(startedKey.split(',').filter(Boolean))
  const available = performances.filter((p) => !started.has(p.id))
  const days = groupByDay(available)

  const requested = params.get('date')
  const [selectedId, setSelectedId] = useState<string | null>(requested)
  const selected = available.find((p) => p.id === selectedId) ?? available[0]

  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    initialQuantities(selected?.ticketTypes ?? []),
  )
  const [seatIds, setSeatIds] = useState<string[]>([])

  // Дату могут выбрать на первом экране ссылкой ?date=<id>: подхватываем смену параметра
  // без перезагрузки (паттерн «состояние от предыдущего значения», без эффекта).
  const [seenRequested, setSeenRequested] = useState(requested)
  if (requested !== seenRequested) {
    setSeenRequested(requested)
    const target = available.find((p) => p.id === requested)
    if (target) {
      setSelectedId(target.id)
      setQuantities(initialQuantities(target.ticketTypes))
      setSeatIds([])
    }
  }

  if (!selected) {
    return (
      <p className={styles.empty} role="status">
        Ближайших показов нет. Новые даты появятся здесь, как только театр их откроет.
      </p>
    )
  }

  const date = formatPerformanceDate(selected.startsAt)
  const selectedDay = days.find((d) => d.items.some((p) => p.id === selected.id))
  const seating = selected.seating
  const seatPricesSet = seating ? Object.keys(seating.pricesKopecks).length > 0 : false

  // Только категории выбранного показа: выбор мог смениться после гидрации.
  const selectedQuantities = Object.fromEntries(
    selected.ticketTypes.map((t) => [t.id, quantities[t.id] ?? 0]),
  )
  const categoryQuote = quoteOrder(selected.ticketTypes, selectedQuantities)
  const ticketCount = Object.values(selectedQuantities).reduce((sum, q) => sum + q, 0)
  const seatQuote = seating
    ? quoteSeats(seating.plan, seating.pricesKopecks, new Set(seating.unavailableSeatIds), seatIds)
    : null

  const order = seating
    ? seatQuote?.ok
      ? { count: seatQuote.quote.ticketCount, total: seatQuote.quote.totalKopecks, ok: true }
      : { count: 0, total: 0, ok: false }
    : categoryQuote.ok
      ? {
          count: categoryQuote.quote.ticketCount,
          total: categoryQuote.quote.totalKopecks,
          ok: true,
        }
      : { count: 0, total: 0, ok: false }

  // Страница оформления получает только выбор; цены и занятость она пересчитывает сама.
  const checkoutHref = `/checkout/${selected.id}?${selectionToSearch(
    seating ? { kind: 'seats', seatIds } : { kind: 'tickets', quantities: selectedQuantities },
  )}`

  const select = (performance: SalePerformance) => {
    if (performance.id === selected.id) return
    setSelectedId(performance.id)
    setQuantities(initialQuantities(performance.ticketTypes))
    setSeatIds([])
  }

  const change = (type: TicketType, delta: number) => {
    const current = quantities[type.id] ?? 0
    const max = Math.min(remainingOf(type), MAX_TICKETS_PER_ORDER)
    const next = current + delta
    // aria-disabled вместо disabled: кнопка не теряет фокус (WCAG 2.4.3).
    if (next < 0 || next > max || (delta > 0 && ticketCount >= MAX_TICKETS_PER_ORDER)) return
    setQuantities((prev) => ({ ...prev, [type.id]: next }))
  }

  const toggleSeat = (seatId: string) => {
    setSeatIds((prev) =>
      prev.includes(seatId) ? prev.filter((id) => id !== seatId) : [...prev, seatId],
    )
  }

  const ticketsWord = (n: number) =>
    n % 10 === 1 && n % 100 !== 11
      ? 'билет'
      : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)
        ? 'билета'
        : 'билетов'

  const orderBar = (
    <div className={styles.orderBar} role="status">
      <p className={styles.orderBarText}>
        {order.ok ? (
          <>
            <span className={styles.orderBarCount}>
              {order.count} {ticketsWord(order.count)}
            </span>
            <span className={styles.orderBarTotal}>{formatRub(order.total)}</span>
          </>
        ) : (
          <span className={styles.orderBarEmpty}>
            {seating ? 'Выберите места на схеме' : 'Выберите билеты'}
          </span>
        )}
      </p>
      {order.ok ? (
        <Link href={checkoutHref} className={`${buttons.button} ${styles.orderBarButton}`}>
          Оформить заказ <span aria-hidden="true">→</span>
        </Link>
      ) : (
        <span className={`${buttons.button} ${styles.orderBarButton}`} aria-disabled="true">
          Оформить заказ
        </span>
      )}
    </div>
  )

  const closedNotice = (
    <div className={styles.card}>
      <p className={styles.cardTitle}>Продажа на сайте пока не открыта</p>
      <p className={styles.note}>
        {seating
          ? 'Схема зала готова, цены категорий театр ещё не утвердил. '
          : 'Театр ещё не открыл продажу этого показа на новом сайте. '}
        Билеты можно купить на{' '}
        <a href={fallbackUrl} rel="noopener">
          текущем сайте театра
        </a>
        .
      </p>
    </div>
  )

  return (
    <>
      <div className={styles.sectionHead}>
        <div>
          <p className={styles.eyebrow}>
            <span>Шаг 1</span> Дата
          </p>
          <h2 className={styles.title}>Когда пойдёте?</h2>
        </div>
        <p className={styles.hint}>
          {days.length > 1 ? `${days.length} ${daysWord(days.length)} впереди` : 'Один показ'}
        </p>
      </div>

      <ul className={styles.strip} aria-label="Даты показов">
        {days.map((day) => {
          const first = day.items[0]!
          const d = formatPerformanceDate(first.startsAt)
          const isSelected = day.key === selectedDay?.key
          return (
            <li key={day.key}>
              <button
                type="button"
                className={styles.day}
                aria-pressed={isSelected}
                onClick={() => select(first)}
              >
                <span className={styles.dayNum}>
                  {d.day} <span className={styles.dayMonth}>{d.month}</span>
                </span>
                <span className={styles.weekday}>{d.weekday}</span>
                <span className={styles.times}>
                  {day.items.map((p) => (
                    <span key={p.id} className={styles.timePill}>
                      {formatPerformanceDate(p.startsAt).time}
                    </span>
                  ))}
                </span>
                <span className={styles.status}>
                  <AvailabilityIndicator
                    availability={dayAvailability(day.items)}
                    tone={isSelected ? 'dark' : 'light'}
                  />
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className={styles.session}>
        <div>
          <p className={styles.sessionTitle}>
            {date.longDate}, {date.weekday} в {date.time}
          </p>
          <p className={styles.sessionVenue}>
            <VenueTag kind={selected.venue.kind} /> {selected.venue.title} ·{' '}
            {selected.venue.address}
          </p>
        </div>
        {/* Время показывается всегда — готово к нескольким сеансам в день. */}
        {selectedDay && (
          <div className={styles.sessionTimes} role="group" aria-label="Время начала">
            {selectedDay.items.map((p) => (
              <div key={p.id} className={styles.sessionTime}>
                <button type="button" aria-pressed={p.id === selected.id} onClick={() => select(p)}>
                  {formatPerformanceDate(p.startsAt).time}
                </button>
                <AvailabilityIndicator availability={p.availability} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`${styles.sectionHead} ${styles.second}`}>
        <div>
          <p className={styles.eyebrow}>
            <span>Шаг 2</span> {seating ? 'Места' : 'Билеты'}
          </p>
          <h2 className={styles.title}>{seating ? 'Выберите места' : 'Сколько билетов?'}</h2>
        </div>
        <p className={styles.hint}>
          {!seating
            ? 'Места по категориям, без схемы зала'
            : seatPricesSet
              ? `${seating.plan.title} · нажмите на место на схеме`
              : seating.plan.title}
        </p>
      </div>

      {seating ? (
        <div className={styles.stack}>
          <div className={styles.card}>
            <SeatMap
              seating={seating}
              selectedIds={seatIds}
              interactive={seatPricesSet}
              maxSeats={MAX_TICKETS_PER_ORDER}
              onToggle={toggleSeat}
            />
          </div>
          {seatPricesSet ? orderBar : closedNotice}
        </div>
      ) : selected.availability?.level === 'none' ? (
        <div className={styles.card}>
          <p className={styles.cardTitle}>Билетов нет</p>
          <p className={styles.note}>
            На этот показ все билеты проданы. Выберите другую дату выше.
          </p>
        </div>
      ) : selected.salesOpen ? (
        <div className={styles.stack}>
          <fieldset className={styles.card}>
            <legend className={styles.cardTitle}>Категории</legend>
            <ul className={styles.types}>
              {selected.ticketTypes.map((type) => {
                const qty = quantities[type.id] ?? 0
                const max = Math.min(remainingOf(type), MAX_TICKETS_PER_ORDER)
                const labelId = `${ids}-${type.id}`
                return (
                  <li key={type.id} className={styles.type}>
                    <div>
                      <p id={labelId} className={styles.typeTitle}>
                        {type.title}
                      </p>
                      <p className={styles.price}>
                        {formatRub(type.priceKopecks)}
                        {type.placeholder && (
                          <span className={styles.placeholder}> · предварительная цена</span>
                        )}
                      </p>
                    </div>
                    <div className={styles.stepper} role="group" aria-labelledby={labelId}>
                      <button
                        type="button"
                        onClick={() => change(type, -1)}
                        aria-disabled={qty === 0}
                        aria-label={`Убрать билет: ${type.title}`}
                      >
                        −
                      </button>
                      <output>
                        <span className="visually-hidden">Количество: </span>
                        {qty}
                      </output>
                      <button
                        type="button"
                        onClick={() => change(type, 1)}
                        aria-disabled={qty >= max || ticketCount >= MAX_TICKETS_PER_ORDER}
                        aria-label={`Добавить билет: ${type.title}`}
                      >
                        +
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className={styles.note}>
              Не больше {MAX_TICKETS_PER_ORDER} билетов в одном заказе. Электронные билеты придут на
              почту.
            </p>
          </fieldset>
          {orderBar}
        </div>
      ) : (
        closedNotice
      )}
    </>
  )
}
