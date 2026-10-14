'use client'

import { useSearchParams } from 'next/navigation'
import { useId, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'

import { formatRub } from '@/lib/money'
import {
  MAX_TICKETS_PER_ORDER,
  parseContact,
  quoteOrder,
  type ContactErrors,
} from '@/modules/checkout'
import { formatPerformanceDate, type SalePerformance, type TicketType } from '@/modules/shows'

import buttons from '../ui/button.module.css'
import { VenueTag } from '../ui/VenueTag'
import styles from './ShowBooking.module.css'

type Props = {
  showTitle: string
  performances: SalePerformance[]
  /** Страница спектакля на текущем сайте театра (продажи через Ticketscloud). */
  fallbackUrl: string
}

type Errors = ContactErrors & { tickets?: string }
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

const initialQuantities = (types: TicketType[]) =>
  Object.fromEntries(types.map((t, i) => [t.id, i === 0 ? 1 : 0]))

export function ShowBooking({ showTitle, performances, fallbackUrl }: Props) {
  const ids = useId()
  const params = useSearchParams()
  const emailRef = useRef<HTMLInputElement>(null)
  const consentRef = useRef<HTMLInputElement>(null)

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
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [paymentUnavailable, setPaymentUnavailable] = useState(false)

  if (!selected) {
    return (
      <p className={styles.empty} role="status">
        Ближайших показов нет. Новые даты появятся здесь, как только театр их откроет.
      </p>
    )
  }

  const date = formatPerformanceDate(selected.startsAt)
  const selectedDay = days.find((d) => d.items.some((p) => p.id === selected.id))
  // Только категории выбранного показа: выбор мог смениться после гидрации.
  const selectedQuantities = Object.fromEntries(
    selected.ticketTypes.map((t) => [t.id, quantities[t.id] ?? 0]),
  )
  const result = quoteOrder(selected.ticketTypes, selectedQuantities)
  const ticketCount = Object.values(selectedQuantities).reduce((sum, q) => sum + q, 0)

  const select = (performance: SalePerformance) => {
    if (performance.id === selected.id) return
    setSelectedId(performance.id)
    setQuantities(initialQuantities(performance.ticketTypes))
    setErrors({})
    setPaymentUnavailable(false)
  }

  const change = (type: TicketType, delta: number) => {
    const current = quantities[type.id] ?? 0
    const max = Math.min(type.capacity, MAX_TICKETS_PER_ORDER)
    const next = current + delta
    // aria-disabled вместо disabled: кнопка не теряет фокус (WCAG 2.4.3).
    if (next < 0 || next > max || (delta > 0 && ticketCount >= MAX_TICKETS_PER_ORDER)) return
    setPaymentUnavailable(false)
    setErrors((prev) => ({ ...prev, tickets: undefined }))
    setQuantities((prev) => ({ ...prev, [type.id]: next }))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const contact = parseContact({ email, consent })
    const nextErrors: Errors = contact.ok ? {} : { ...contact.errors }
    if (!result.ok) nextErrors.tickets = 'Выберите хотя бы один билет'
    setErrors(nextErrors)
    if (nextErrors.email) return emailRef.current?.focus()
    if (nextErrors.consent) return consentRef.current?.focus()
    if (nextErrors.tickets) return
    // Банк и параметры чека ещё не подтверждены (T-001/T-002): платёж не создаём,
    // ничего не бронируем и не показываем «оплачено» (rules.md §7, §9).
    setPaymentUnavailable(true)
  }

  return (
    <>
      <div className={styles.sectionHead}>
        <div>
          <p className={styles.eyebrow}>
            <span>01</span> Афиша
          </p>
          <h2 className={styles.title}>Ближайшие даты</h2>
        </div>
        <p className={styles.hint}>Выберите дату и время</p>
      </div>

      <ul className={styles.strip} aria-label="Даты показов">
        {days.map((day) => {
          const first = day.items[0]!
          const d = formatPerformanceDate(first.startsAt)
          const open = day.items.some((p) => p.salesOpen)
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
                <span className={styles.status} data-open={open}>
                  {open ? 'Билеты есть' : 'Продажа на сайте не открыта'}
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
        {selectedDay && selectedDay.items.length > 1 && (
          <div className={styles.sessionTimes} role="group" aria-label="Время начала">
            {selectedDay.items.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={p.id === selected.id}
                onClick={() => select(p)}
              >
                {formatPerformanceDate(p.startsAt).time}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`${styles.sectionHead} ${styles.second}`}>
        <div>
          <p className={styles.eyebrow}>
            <span>02</span> Билеты
          </p>
          <h2 className={styles.title}>Выбор билетов</h2>
        </div>
        <p className={styles.hint}>Без схемы зала — места по категориям</p>
      </div>

      {selected.salesOpen ? (
        <form className={styles.booking} onSubmit={submit} noValidate>
          <fieldset className={styles.card}>
            <legend className={styles.cardTitle}>Категории</legend>
            <ul className={styles.types}>
              {selected.ticketTypes.map((type) => {
                const qty = quantities[type.id] ?? 0
                const max = Math.min(type.capacity, MAX_TICKETS_PER_ORDER)
                const labelId = `${ids}-${type.id}`
                return (
                  <li key={type.id} className={styles.type}>
                    <div>
                      <p id={labelId} className={styles.typeTitle}>
                        {type.title}
                      </p>
                      <p className={styles.price}>{formatRub(type.priceKopecks)}</p>
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
            {errors.tickets && (
              <p className={styles.error} role="alert">
                {errors.tickets}
              </p>
            )}
          </fieldset>

          <aside className={`${styles.card} ${styles.summary}`} aria-labelledby={`${ids}-order`}>
            <h3 id={`${ids}-order`} className={styles.cardTitle}>
              Ваш заказ
            </h3>
            <p className={styles.orderFor}>
              {showTitle} · {date.longDate} {date.time}
            </p>
            {result.ok ? (
              <dl className={styles.lines}>
                {result.quote.lines.map((line) => (
                  <div key={line.ticketTypeId}>
                    <dt>
                      {line.title} × {line.quantity}
                    </dt>
                    <dd>{formatRub(line.totalKopecks)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className={styles.emptyOrder}>Билеты ещё не выбраны.</p>
            )}
            <dl className={styles.totals}>
              <div>
                <dt>Билетов</dt>
                <dd>{result.ok ? result.quote.ticketCount : 0}</dd>
              </div>
              <div className={styles.total}>
                <dt>Итого</dt>
                <dd>{formatRub(result.ok ? result.quote.totalKopecks : 0)}</dd>
              </div>
            </dl>

            <label htmlFor={`${ids}-email`} className={styles.label}>
              Электронная почта <span className={styles.required}>(обязательно)</span>
            </label>
            <input
              ref={emailRef}
              id={`${ids}-email`}
              type="email"
              inputMode="email"
              autoComplete="email"
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-required="true"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? `${ids}-email-error` : undefined}
            />
            {errors.email && (
              <p id={`${ids}-email-error`} className={styles.error}>
                {errors.email}
              </p>
            )}
            <div className={styles.consent}>
              <input
                ref={consentRef}
                id={`${ids}-consent`}
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                aria-required="true"
                aria-invalid={Boolean(errors.consent)}
                aria-describedby={errors.consent ? `${ids}-consent-error` : undefined}
              />
              <label htmlFor={`${ids}-consent`}>
                Согласен на обработку персональных данных для оформления билетов{' '}
                <span className={styles.required}>(обязательно)</span>
              </label>
            </div>
            {errors.consent && (
              <p id={`${ids}-consent-error`} className={styles.error}>
                {errors.consent}
              </p>
            )}

            <button type="submit" className={`${buttons.button} ${styles.submit}`}>
              Оформить заказ
            </button>

            {/* Живой регион есть всегда — сообщение появляется внутри (WCAG 4.1.3). */}
            <div role="status">
              {paymentUnavailable && (
                <div className={styles.notice}>
                  <p className={styles.noticeTitle}>Оплата на сайте ещё не подключена</p>
                  <p>
                    Мы подключаем банк театра. Места не забронированы, деньги не списаны. Купить
                    билет сейчас можно на{' '}
                    <a href={fallbackUrl} rel="noopener">
                      текущем сайте театра
                    </a>
                    .
                  </p>
                </div>
              )}
            </div>
          </aside>
        </form>
      ) : (
        <div className={styles.card}>
          <p className={styles.cardTitle}>Продажа на сайте пока не открыта</p>
          <p className={styles.note}>
            Театр ещё не открыл продажу этого показа на новом сайте. Билеты можно купить на{' '}
            <a href={fallbackUrl} rel="noopener">
              текущем сайте театра
            </a>
            .
          </p>
        </div>
      )}
    </>
  )
}
