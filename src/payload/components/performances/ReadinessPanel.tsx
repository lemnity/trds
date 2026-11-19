'use client'

import { useConfig, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { useCallback, useEffect, useState } from 'react'

import { performanceReadiness, type PublishStatus } from './readiness'
import styles from './readinessPanel.module.css'

type Id = number | string
type Ref = Id | { id?: Id; value?: Id } | null | undefined

const refId = (ref: Ref): Id | null => {
  if (ref === null || ref === undefined || ref === '') return null
  if (typeof ref === 'object') return ref.id ?? ref.value ?? null
  return ref
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

const getJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(`Ошибка ${res.status}`)
  return (await res.json()) as T
}

/** Опубликованность — по основной записи (без draft): черновик на сайте не виден. */
const loadStatus = async (apiUrl: string, slug: string, id: Id | null): Promise<PublishStatus> => {
  if (id === null) return null
  const doc = await getJson<{ _status?: string | null }>(
    `${apiUrl}/${slug}/${encodeURIComponent(String(id))}?depth=0&select[_status]=true`,
  )
  return doc._status === 'published' ? 'published' : 'draft'
}

const loadTicketTypes = async (apiUrl: string, performanceId: Id | undefined | null) => {
  if (performanceId === undefined || performanceId === null) return []
  const res = await getJson<{ docs: { code: string }[] }>(
    `${apiUrl}/ticket-types?where[performance][equals]=${encodeURIComponent(String(performanceId))}&depth=0&select[code]=true&pagination=false`,
  )
  return res.docs
}

type Remote = {
  showStatus: PublishStatus
  venueStatus: PublishStatus
  ticketTypes: { code: string }[]
}

/**
 * Боковая панель показа «Готовность к продаже»: что мешает появиться кнопке «Купить».
 * Значения — из формы (видны сразу, до сохранения); статусы спектакля и площадки и категории
 * билетов — по REST (после «Обновить» и после сохранения показа).
 */
export function ReadinessPanel() {
  const { id, lastUpdateTime } = useDocumentInfo()
  const { config } = useConfig()
  const apiUrl = `${config.serverURL}${config.routes.api}`

  const show = refId(useFormFields(([f]) => f.show?.value) as Ref)
  const venue = refId(useFormFields(([f]) => f.venue?.value) as Ref)
  const startsAt = str(useFormFields(([f]) => f.startsAt?.value))
  const salesStartAt = str(useFormFields(([f]) => f.salesStartAt?.value))
  const salesEndAt = str(useFormFields(([f]) => f.salesEndAt?.value))
  const planId = str(useFormFields(([f]) => f['seating.planId']?.value))
  const pricing = useFormFields(([f]) => f['seating.pricing']?.value)
  const status = useFormFields(([f]) => f._status?.value)
  const closed = useFormFields(([f]) => f['seating.unavailableSeatIds']?.value)

  const [remote, setRemote] = useState<Remote | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadStatus(apiUrl, 'shows', show),
      loadStatus(apiUrl, 'venues', venue),
      loadTicketTypes(apiUrl, id),
    ]).then(
      ([showStatus, venueStatus, ticketTypes]) => {
        if (cancelled) return
        setRemote({ showStatus, venueStatus, ticketTypes })
        setError(null)
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось проверить')
      },
    )
    return () => {
      cancelled = true
    }
  }, [apiUrl, show, venue, id, lastUpdateTime, version])

  const readiness = remote
    ? performanceReadiness({
        performance: {
          startsAt: startsAt ?? '',
          salesStartAt,
          salesEndAt,
          seating: { planId, pricing },
        },
        ticketTypes: remote.ticketTypes,
        showStatus: remote.showStatus,
        venueStatus: remote.venueStatus,
        performanceStatus: status === 'published' ? 'published' : 'draft',
        closedSeatIds: Array.isArray(closed) ? closed.map(String) : [],
        now: new Date(),
      })
    : null

  return (
    <div className={styles.root}>
      <h4 className={styles.title}>Готовность к продаже</h4>

      {error && (
        <p className={styles.blocked}>
          Не удалось проверить: {error}.{' '}
          <button type="button" className={styles.linkButton} onClick={reload}>
            Повторить
          </button>
        </p>
      )}
      {!readiness && !error && <p className={styles.note}>Проверяем…</p>}

      {readiness && (
        <>
          <p className={`${styles.summary} ${readiness.ready ? styles.ready : styles.blocked}`}>
            {readiness.ready
              ? 'Готов к продаже'
              : `Продажи не откроются: ${readiness.problems.join(', ')}`}
          </p>
          <ul className={styles.list}>
            {readiness.items.map((item) => (
              <li key={item.id} className={`${styles.item} ${styles[item.state]}`}>
                <span className={styles.mark} aria-hidden="true">
                  {item.state === 'ok' ? '✓' : item.state === 'fail' ? '✗' : '!'}
                </span>
                <span>
                  {item.label}
                  {item.hint && <span className={styles.hint}>{item.hint}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            Категории билетов и статусы спектакля и площадки учитываются по сохранённым данным.{' '}
            <button type="button" className={styles.linkButton} onClick={reload}>
              Обновить
            </button>
          </p>
        </>
      )}
    </div>
  )
}
