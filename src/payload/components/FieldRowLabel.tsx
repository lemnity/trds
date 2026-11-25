'use client'

import { useConfig, useRowLabel } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

/**
 * Заголовок строки массива по её данным: «Режиссёр» вместо «Должность 01», «Артём Аксёнов»
 * вместо «Человек 01». Берётся текстовое поле `field`; если оно пустое — имена из поля связи
 * `people` (коллекция «Люди»); если и их нет — как у Payload: «<fallback> 01».
 * Подключение: admin.components.RowLabel = { path, clientProps: { field?, people?, fallback } }.
 */

type Props = { field?: string; people?: string; fallback: string }

// Имена людей по id — общий кэш на все строки формы.
const names = new Map<number, string>()
const pending = new Map<string, Promise<void>>()

const idOf = (v: unknown): number | null =>
  typeof v === 'number' ? v : v && typeof v === 'object' && 'id' in v ? Number(v.id) : null

export function FieldRowLabel({ field, people, fallback }: Props) {
  const { data, rowNumber = 0 } = useRowLabel<Record<string, unknown> | undefined>()
  const {
    config: {
      serverURL,
      routes: { api },
    },
  } = useConfig()
  const [, setTick] = useState(0)

  const text = field && typeof data?.[field] === 'string' ? (data[field] as string).trim() : ''
  const refs = people && Array.isArray(data?.[people]) ? (data[people] as unknown[]) : []
  const ids = refs.map(idOf).filter((id): id is number => id !== null)
  // Связь может прийти уже раскрытой (с именем).
  for (const r of refs) {
    const id = idOf(r)
    if (id !== null && r && typeof r === 'object' && 'name' in r && typeof r.name === 'string')
      names.set(id, r.name)
  }
  const missing = ids.filter((id) => !names.has(id))
  const missingKey = missing.join(',')

  useEffect(() => {
    if (text || !missingKey) return
    let cancelled = false
    const job =
      pending.get(missingKey) ??
      fetch(
        `${serverURL}${api}/people?where[id][in]=${missingKey}&depth=0&limit=100&select[name]=true`,
        { credentials: 'include' },
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((res: { docs?: { id: number; name?: string }[] } | null) => {
          for (const d of res?.docs ?? []) if (d.name) names.set(d.id, d.name)
        })
        .catch(() => undefined)
        .finally(() => pending.delete(missingKey))
    pending.set(missingKey, job)
    void job.then(() => {
      if (!cancelled) setTick((t) => t + 1)
    })
    return () => {
      cancelled = true
    }
  }, [text, missingKey, serverURL, api])

  const who = ids
    .map((id) => names.get(id))
    .filter(Boolean)
    .join(', ')
  return <span>{text || who || `${fallback} ${String(rowNumber + 1).padStart(2, '0')}`}</span>
}
