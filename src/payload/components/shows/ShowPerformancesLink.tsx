'use client'

import { useConfig, useDocumentInfo } from '@payloadcms/ui'
import Link from 'next/link'
import { useEffect, useState } from 'react'

/**
 * Правая колонка спектакля: только переход к его показам. Спектакль — «что» (описание, состав,
 * картинки); даты, площадки и билеты задаются в «Показах» (решение заказчика 27.11.2026).
 */

const muted = { margin: '6px 0 0', fontSize: 14, color: 'var(--theme-elevation-400)' } as const

const plural = (n: number) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'показ'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'показа'
  return 'показов'
}

export function ShowPerformancesLink() {
  const { id } = useDocumentInfo()
  const {
    config: {
      serverURL,
      routes: { admin, api },
    },
  } = useConfig()
  const [count, setCount] = useState<{ id: unknown; n: number } | null>(null)

  useEffect(() => {
    if (id === undefined || id === null) return
    let cancelled = false
    void fetch(
      `${serverURL}${api}/performances?where[show][equals]=${id}&limit=0&depth=0&draft=true`,
      { credentials: 'include' },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((res: { totalDocs?: number } | null) => {
        if (!cancelled && typeof res?.totalDocs === 'number') setCount({ id, n: res.totalDocs })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [id, serverURL, api])

  const n = count && count.id === id ? count.n : null

  return (
    <div style={{ marginBottom: 'calc(var(--base) * 1.5)' }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>Показы</div>
      {id === undefined || id === null ? (
        <p style={muted}>
          Даты, площадки и билеты задаются в разделе «Показы». После сохранения спектакля здесь
          появится ссылка на его показы.
        </p>
      ) : (
        <>
          <p style={muted}>
            {n === null ? 'Загрузка…' : n === 0 ? 'Показов пока нет.' : `${n} ${plural(n)}.`} Даты,
            площадки и билеты — в разделе «Показы».
          </p>
          <Link
            href={`${admin}/collections/performances?where[show][equals]=${id}`}
            className="btn btn--style-secondary btn--size-small"
            style={{ marginTop: 10, display: 'inline-flex' }}
          >
            Показы этого спектакля →
          </Link>
        </>
      )}
    </div>
  )
}
