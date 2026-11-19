'use client'

import { Button, useAuth, useConfig, useDocumentDrawer, useDocumentInfo } from '@payloadcms/ui'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { formatTheatreDateTime, salesStatusText } from '../performances/format'
import {
  performanceSalesState,
  type SalesPerformance,
  type SalesStatus,
} from '../performances/salesState'
import styles from './showPerformances.module.css'

const PERFORMANCES_SLUG = 'performances'

type Id = number | string

type PerformanceDoc = SalesPerformance & {
  id: Id
  _status?: 'draft' | 'published' | null
  venue?: Id | { id: Id; title?: string | null } | null
}

type TicketTypeDoc = { code: string; performance: Id | { id: Id } }

type Row = {
  id: Id
  startsAt: string
  venueTitle: string
  published: boolean
  /** Опубликован, но последние правки сохранены черновиком. */
  draftChanges: boolean
  sales: SalesStatus
}

const getJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(`Ошибка ${res.status}`)
  return (await res.json()) as T
}

const idOf = (ref: Id | { id: Id }) => (typeof ref === 'object' ? ref.id : ref)

/**
 * Все показы спектакля, включая черновики (join-список Payload черновики не показывает), и
 * категории билетов к ним — одним запросом. Опубликованность — по основной записи (без draft):
 * у опубликованного показа с несохранёнными в публикацию правками последняя версия — черновик.
 */
const loadRows = async (apiUrl: string, showId: Id, now: Date): Promise<Row[]> => {
  const byShow = `where[show][equals]=${encodeURIComponent(String(showId))}`
  const [latest, published] = await Promise.all([
    getJson<{ docs: PerformanceDoc[] }>(
      `${apiUrl}/${PERFORMANCES_SLUG}?${byShow}&draft=true&depth=1&joins=false&sort=startsAt&pagination=false`,
    ),
    getJson<{ docs: { id: Id }[] }>(
      `${apiUrl}/${PERFORMANCES_SLUG}?${byShow}&where[_status][equals]=published&depth=0&joins=false&select[id]=true&pagination=false`,
    ),
  ])
  const byPerformance = latest.docs
    .map((p, i) => `where[performance][in][${i}]=${encodeURIComponent(String(p.id))}`)
    .join('&')
  const types = byPerformance
    ? (
        await getJson<{ docs: TicketTypeDoc[] }>(
          `${apiUrl}/ticket-types?${byPerformance}&depth=0&select[code]=true&select[performance]=true&pagination=false`,
        )
      ).docs
    : []
  const publishedIds = new Set(published.docs.map((p) => String(p.id)))
  return latest.docs.map((p) => {
    const isPublished = publishedIds.has(String(p.id))
    return {
      id: p.id,
      startsAt: p.startsAt,
      venueTitle: (typeof p.venue === 'object' && p.venue?.title) || '—',
      published: isPublished,
      draftChanges: isPublished && p._status !== 'published',
      sales: performanceSalesState(
        p,
        types.filter((t) => String(idOf(t.performance)) === String(p.id)),
        now,
      ).status,
    }
  })
}

const SALES_TONE: Record<SalesStatus['kind'], string | undefined> = {
  open: styles.ok,
  opensLater: styles.pending,
  noPrices: styles.warn,
  closed: styles.muted,
}

/** Вкладка спектакля «Показы и продажи»: список показов с продажами и одна кнопка «Добавить». */
export function ShowPerformancesPanel() {
  const { id } = useDocumentInfo()
  const { config } = useConfig()
  const { permissions } = useAuth()
  const apiUrl = `${config.serverURL}${config.routes.api}`
  const canCreate = permissions?.collections?.[PERFORMANCES_SLUG]?.create === true
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])
  const [PerformanceDrawer, , { openDrawer }] = useDocumentDrawer({
    collectionSlug: PERFORMANCES_SLUG,
  })

  useEffect(() => {
    if (id === undefined || id === null) return
    let cancelled = false
    loadRows(apiUrl, id, new Date()).then(
      (next) => {
        if (cancelled) return
        setRows(next)
        setError(null)
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить показы')
      },
    )
    return () => {
      cancelled = true
    }
  }, [apiUrl, id, version])

  if (id === undefined || id === null)
    return (
      <div className={styles.root}>
        <p className={styles.note}>Сохраните спектакль, чтобы добавить показы.</p>
      </div>
    )

  const adminUrl = config.routes.admin
  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <h3 className={styles.title}>Показы{rows ? ` (${rows.length})` : ''}</h3>
        {canCreate && (
          <Button buttonStyle="primary" size="small" margin={false} onClick={openDrawer}>
            Добавить показ
          </Button>
        )}
      </div>

      {error && (
        <p className={styles.error}>
          Не удалось загрузить показы: {error}.{' '}
          <button type="button" className={styles.linkButton} onClick={reload}>
            Повторить
          </button>
        </p>
      )}

      {!rows && !error && <p className={styles.note}>Загрузка…</p>}

      {rows && rows.length === 0 && (
        <div className={styles.empty}>
          <p>У спектакля пока нет показов.</p>
          <p className={styles.note}>
            Показ — это конкретная дата в конкретном зале. Зал, цены и билеты задаются в показе.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Дата и время</th>
              <th>Площадка</th>
              <th>Статус</th>
              <th>Продажи</th>
              <th aria-label="Ссылка" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className={styles.when}>{formatTheatreDateTime(row.startsAt)}</td>
                <td>{row.venueTitle}</td>
                <td>
                  <span className={row.published ? styles.ok : styles.draft}>
                    {row.published ? 'Опубликован' : 'Черновик'}
                  </span>
                  {row.draftChanges && (
                    <span className={styles.hint}>есть неопубликованные правки</span>
                  )}
                </td>
                <td>
                  <span className={SALES_TONE[row.sales.kind]}>{salesStatusText(row.sales)}</span>
                </td>
                <td className={styles.open}>
                  <Link href={`${adminUrl}/collections/${PERFORMANCES_SLUG}/${row.id}`}>
                    Открыть
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <PerformanceDrawer initialData={{ show: id }} onSave={reload} redirectAfterCreate={false} />
    </div>
  )
}
