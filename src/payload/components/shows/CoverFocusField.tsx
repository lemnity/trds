'use client'

import { useConfig, useField, useFormFields } from '@payloadcms/ui'
import { useEffect, useRef, useState } from 'react'

import styles from './coverFocus.module.css'

/**
 * Фокус обложки визуально: щелчок или перетаскивание по картинке ставит точку, которая всегда
 * остаётся в кадре при обрезке (CSS object-position, «X% Y%»). Рядом — как обложка обрежется на
 * сайте: широкая полоса на компьютере и 4:3 на телефоне (ShowCover / ShowHeaderCompact.module.css).
 * Картинка — как на сайте: «Обложка страницы», иначе первое фото галереи. Пусто — точка фокуса
 * из «Медиа» (если задана), иначе центр.
 */

type MediaDoc = { id: number; url?: string | null; focalX?: number | null; focalY?: number | null }

const idOf = (v: unknown): number | null =>
  typeof v === 'number' ? v : v && typeof v === 'object' && 'id' in v ? Number(v.id) : null

const parse = (v: unknown): { x: number; y: number } | null => {
  const m = typeof v === 'string' ? /^\s*(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*$/.exec(v) : null
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null
}

const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)))

type Source = { id: number | null; url: string | null; from: string }

export function CoverFocusField({ path }: { path: string }) {
  const { value, setValue } = useField<string | null>({ path })
  const {
    config: {
      serverURL,
      routes: { api },
    },
  } = useConfig()

  // Какая картинка будет на сайте: обложка → первое фото галереи (файл, затем старый адрес).
  const sourceKey = useFormFields(([f]) => {
    const coverId = idOf(f.cover?.value)
    const coverUrl = (f.coverUrl?.value as string | null | undefined) || null
    const galleryFiles = (f.galleryFiles?.value as unknown[] | null | undefined) ?? []
    const firstFile = galleryFiles.length ? idOf(galleryFiles[0]) : null
    const legacyId = idOf(f['gallery.0.image']?.value)
    const legacyUrl = (f['gallery.0.imageUrl']?.value as string | null | undefined) || null
    let s: Source | null = null
    if (coverId !== null) s = { id: coverId, url: null, from: 'Обложка страницы' }
    else if (coverUrl) s = { id: null, url: coverUrl, from: 'Обложка страницы' }
    else if (firstFile !== null) s = { id: firstFile, url: null, from: 'первое фото галереи' }
    else if (legacyId !== null) s = { id: legacyId, url: null, from: 'первое фото галереи' }
    else if (legacyUrl) s = { id: null, url: legacyUrl, from: 'первое фото галереи' }
    return JSON.stringify(s)
  })
  const source = JSON.parse(sourceKey) as Source | null

  const [media, setMedia] = useState<MediaDoc | null>(null)
  const sourceId = source?.id ?? null
  useEffect(() => {
    if (sourceId === null) return
    let cancelled = false
    void fetch(`${serverURL}${api}/media/${sourceId}?depth=0`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((doc: MediaDoc | null) => {
        if (!cancelled) setMedia(doc)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [sourceId, serverURL, api])

  const fresh = sourceId !== null && media?.id === sourceId ? media : null
  const src = source?.url ?? fresh?.url ?? null
  const mediaFocus =
    fresh && fresh.focalX != null && fresh.focalY != null
      ? { x: fresh.focalX, y: fresh.focalY }
      : null
  const own = parse(value)
  const point = own ?? mediaFocus ?? { x: 50, y: 50 }
  const position = `${point.x}% ${point.y}%`

  const frame = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const setFromEvent = (e: React.PointerEvent) => {
    const box = frame.current?.getBoundingClientRect()
    if (!box) return
    const x = clamp(((e.clientX - box.left) / box.width) * 100)
    const y = clamp(((e.clientY - box.top) / box.height) * 100)
    setValue(`${x}% ${y}%`)
  }
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    setValue(`${clamp(point.x + move[0])}% ${clamp(point.y + move[1])}%`)
  }

  return (
    <div className={styles.field}>
      <div className={styles.head}>
        <span className={styles.label}>Фокус обложки</span>
        {own && (
          <button type="button" className={styles.reset} onClick={() => setValue(null)}>
            Сбросить
          </button>
        )}
      </div>
      <p className={styles.hint}>
        Щёлкните по главному на картинке — например, по лицам актёров. Эта точка всегда останется в
        кадре, когда сайт обрежет обложку под экран компьютера или телефона.
      </p>

      {!src ? (
        <p className={styles.empty}>
          Сначала загрузите «Обложку страницы» или фото в галерею — тогда здесь появится картинка.
        </p>
      ) : (
        <div className={styles.layout}>
          <div>
            <div
              ref={frame}
              className={styles.picker}
              role="slider"
              tabIndex={0}
              aria-label="Точка фокуса обложки: стрелки — сдвиг, Shift — крупнее"
              aria-valuetext={`по горизонтали ${point.x}%, по вертикали ${point.y}%`}
              aria-valuenow={point.x}
              aria-valuemin={0}
              aria-valuemax={100}
              onPointerDown={(e) => {
                dragging.current = true
                e.currentTarget.setPointerCapture(e.pointerId)
                setFromEvent(e)
              }}
              onPointerMove={(e) => {
                if (dragging.current) setFromEvent(e)
              }}
              onPointerUp={() => {
                dragging.current = false
              }}
              onKeyDown={onKey}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- превью в админке */}
              <img src={src} alt="" draggable={false} />
              <span
                className={styles.dot}
                data-own={own ? 'true' : 'false'}
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
                aria-hidden="true"
              />
            </div>
            <p className={styles.caption}>
              Картинка: {source?.from}.{' '}
              {own
                ? `Точка: ${point.x}% слева, ${point.y}% сверху.`
                : mediaFocus
                  ? 'Точка не задана — берётся из «Медиа».'
                  : 'Точка не задана — центр картинки.'}
            </p>
          </div>

          <div className={styles.previews}>
            <figure>
              <div className={`${styles.preview} ${styles.wide}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- превью в админке */}
                <img src={src} alt="" style={{ objectPosition: position }} />
              </div>
              <figcaption>На компьютере</figcaption>
            </figure>
            <figure>
              <div className={`${styles.preview} ${styles.phone}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- превью в админке */}
                <img src={src} alt="" style={{ objectPosition: position }} />
              </div>
              <figcaption>На телефоне</figcaption>
            </figure>
          </div>
        </div>
      )}
    </div>
  )
}
