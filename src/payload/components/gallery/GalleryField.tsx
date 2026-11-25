'use client'

import { useConfig, useField, useForm, useFormFields } from '@payloadcms/ui'
import { useEffect, useRef, useState } from 'react'

import styles from './gallery.module.css'

/**
 * Галерея в админке: сетка миниатюр с кнопками «Заменить» и «Удалить» и одна кнопка
 * «Добавить фото» (сразу несколько файлов). Хранение — прежнее (src/payload/fields.ts → galleryField):
 * `<name>Files` — файлы из «Медиа»; `<name>` — строки с адресами старого сайта (скрыты в админке,
 * показываются в этой же сетке). Новые файлы загружаются в «Медиа» с описанием по названию записи.
 */

type Item =
  | { kind: 'file'; index: number; id: number }
  | { kind: 'legacy'; index: number; mediaId: number | null; url: string | null }

type MediaDoc = { id: number; url?: string | null; sizes?: { card?: { url?: string | null } } }

const idOf = (v: unknown): number | null =>
  typeof v === 'number' ? v : v && typeof v === 'object' && 'id' in v ? Number(v.id) : null

export function GalleryField({ path }: { path: string }) {
  const legacyPath = path.replace(/Files$/, '')
  const { value, setValue } = useField<unknown[] | null>({ path })
  const { dispatchFields, removeFieldRow } = useForm()
  const {
    config: {
      serverURL,
      routes: { api },
    },
  } = useConfig()
  const title = useFormFields(([fields]) => fields.title?.value)
  const legacyKey = useFormFields(([fields]) => {
    const rows = fields[legacyPath]?.rows?.length ?? Number(fields[legacyPath]?.value ?? 0)
    return JSON.stringify(
      Array.from({ length: rows }, (_, i) => [
        idOf(fields[`${legacyPath}.${i}.image`]?.value),
        (fields[`${legacyPath}.${i}.imageUrl`]?.value as string | null | undefined) ?? null,
      ]),
    )
  })
  const legacy = (JSON.parse(legacyKey) as [number | null, string | null][]).map(
    ([mediaId, url]) => ({ mediaId, url }),
  )

  const files = (value ?? []).map(idOf).filter((id): id is number => id !== null)
  const items: Item[] = [
    ...files.map((id, index) => ({ kind: 'file' as const, index, id })),
    ...legacy.map((l, index) => ({ kind: 'legacy' as const, index, ...l })),
  ]

  // Адреса миниатюр файлов из «Медиа».
  const [urls, setUrls] = useState<Record<number, string>>({})
  const idsKey = [...files, ...legacy.map((l) => l.mediaId)]
    .filter((id): id is number => id !== null && !(id in urls))
    .join(',')
  useEffect(() => {
    if (!idsKey) return
    let cancelled = false
    void fetch(`${serverURL}${api}/media?where[id][in]=${idsKey}&depth=0&limit=200`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((res: { docs?: MediaDoc[] } | null) => {
        if (cancelled || !res?.docs) return
        const docs = res.docs
        setUrls((prev) => {
          const next = { ...prev }
          for (const d of docs) next[d.id] = d.sizes?.card?.url || d.url || ''
          return next
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [idsKey, serverURL, api])

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const addInput = useRef<HTMLInputElement>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  const replacing = useRef<Item | null>(null)

  const upload = async (file: File): Promise<number> => {
    const form = new FormData()
    form.append('file', file)
    const alt = typeof title === 'string' && title ? `«${title}» — фото` : 'Фото'
    form.append('_payload', JSON.stringify({ alt }))
    const res = await fetch(`${serverURL}${api}/media`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    })
    const body = (await res.json().catch(() => null)) as {
      doc?: MediaDoc
      errors?: { message?: string }[]
    } | null
    if (!res.ok || !body?.doc)
      throw new Error(body?.errors?.[0]?.message ?? `«${file.name}» не загрузился`)
    const doc = body.doc
    setUrls((prev) => ({ ...prev, [doc.id]: doc.sizes?.card?.url || doc.url || '' }))
    return doc.id
  }

  const run = async (job: () => Promise<void>) => {
    setError(null)
    try {
      await job()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить файл')
    } finally {
      setBusy(null)
    }
  }

  const onAdd = (list: FileList | null) => {
    const picked = [...(list ?? [])]
    if (!picked.length) return
    void run(async () => {
      const added: number[] = []
      for (const [i, f] of picked.entries()) {
        setBusy(`Загрузка ${i + 1} из ${picked.length}…`)
        added.push(await upload(f))
        setValue([...files, ...added])
      }
    })
  }

  const onReplace = (file: File | undefined) => {
    const item = replacing.current
    replacing.current = null
    if (!file || !item) return
    setBusy('Замена…')
    void run(async () => {
      const id = await upload(file)
      if (item.kind === 'file') setValue(files.map((f, i) => (i === item.index ? id : f)))
      else {
        // Строка старого сайта: файл встаёт на её место, адрес очищается — порядок сохраняется.
        dispatchFields({ type: 'UPDATE', path: `${legacyPath}.${item.index}.image`, value: id })
        dispatchFields({
          type: 'UPDATE',
          path: `${legacyPath}.${item.index}.imageUrl`,
          value: null,
        })
      }
    })
  }

  const onRemove = (item: Item) => {
    if (item.kind === 'file') setValue(files.filter((_, i) => i !== item.index))
    else removeFieldRow({ path: legacyPath, rowIndex: item.index })
  }

  const srcOf = (item: Item) =>
    item.kind === 'file'
      ? urls[item.id]
      : (item.mediaId !== null ? urls[item.mediaId] : undefined) || item.url || undefined

  return (
    <div className={styles.gallery}>
      <div className={styles.header}>
        <span className={styles.label}>Фото</span>
        <button
          type="button"
          className={styles.add}
          disabled={!!busy}
          onClick={() => addInput.current?.click()}
        >
          + Добавить фото
        </button>
      </div>
      <p className={styles.hint}>
        Можно выбрать сразу несколько файлов: JPEG, PNG или WebP. На сайте — в том же порядке.
      </p>
      {busy && <p className={styles.status}>{busy}</p>}
      {error && <p className={styles.error}>{error}</p>}

      {items.length === 0 ? (
        <p className={styles.empty}>Фото пока нет.</p>
      ) : (
        <ul className={styles.grid}>
          {items.map((item) => {
            const src = srcOf(item)
            return (
              <li key={`${item.kind}-${item.index}`} className={styles.item}>
                <div className={styles.thumb}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- миниатюра в админке */}
                  {src ? <img src={src} alt="" loading="lazy" /> : <span>…</span>}
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => {
                      replacing.current = item
                      replaceInput.current?.click()
                    }}
                  >
                    Заменить
                  </button>
                  <button
                    type="button"
                    className={styles.remove}
                    disabled={!!busy}
                    onClick={() => onRemove(item)}
                  >
                    Удалить
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <input
        ref={addInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        multiple
        hidden
        onChange={(e) => {
          onAdd(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={replaceInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        hidden
        onChange={(e) => {
          onReplace(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}
