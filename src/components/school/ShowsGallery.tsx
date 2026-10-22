'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { reveal } from '@/components/ui/reveal'

import styles from './ShowsGallery.module.css'

export type StagedShow = { title: string; photos: string[] }

/**
 * Поставленные спектакли: плитка — кнопка, открывает модальную галерею спектакля (нативный
 * `<dialog>`: фокус внутри, Esc закрывает). Стрелки ← →, кнопки и свайп листают, клик по фону закрывает.
 */
export function ShowsGallery({ shows, label }: { shows: StagedShow[]; label: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const touchX = useRef<number | null>(null)
  const [open, setOpen] = useState<{ show: number; photo: number } | null>(null)

  const show = open ? shows[open.show] : undefined
  const count = show?.photos.length ?? 0

  const go = useCallback(
    (step: number) => setOpen((o) => o && { ...o, photo: (o.photo + step + count) % count }),
    [count],
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      document.documentElement.style.overflow = 'hidden'
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  const onClose = () => {
    document.documentElement.style.overflow = ''
    setOpen(null)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(1)
    else if (e.key === 'ArrowLeft') go(-1)
    else return
    e.preventDefault()
  }

  return (
    <>
      <ul className={styles.grid} aria-label={label}>
        {shows.map((s, i) => (
          <li key={s.title} {...reveal(i % 4)}>
            <button
              type="button"
              className={styles.tile}
              onClick={() => setOpen({ show: i, photo: 0 })}
              aria-haspopup="dialog"
            >
              <span className={styles.photo}>
                <Image
                  src={s.photos[0]!}
                  alt=""
                  fill
                  sizes="(min-width: 70rem) 15vw, (min-width: 60rem) 25vw, 50vw"
                />
                <span className={styles.count} aria-hidden="true">
                  {s.photos.length} фото
                </span>
              </span>
              <span className={styles.title}>{s.title}</span>
              <span className="visually-hidden">: открыть галерею, {s.photos.length} фото</span>
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby="staged-show-title"
        onClose={onClose}
        onKeyDown={onKeyDown}
        onClick={(e) => {
          // Клик по тёмному фону вокруг фото (не по фото и кнопкам) закрывает.
          if ((e.target as HTMLElement).hasAttribute('data-backdrop')) dialogRef.current?.close()
        }}
      >
        {show && open && (
          <div className={styles.inner} data-backdrop>
            <header className={styles.bar}>
              <h2 id="staged-show-title" className={styles.dialogTitle}>
                {show.title}
              </h2>
              <span className={styles.counter} aria-live="polite">
                {open.photo + 1} / {count}
              </span>
              <button
                type="button"
                className={styles.close}
                onClick={() => dialogRef.current?.close()}
                aria-label="Закрыть галерею"
                autoFocus
              >
                ×
              </button>
            </header>

            <div
              className={styles.stage}
              data-backdrop
              onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
              onTouchEnd={(e) => {
                const start = touchX.current
                const end = e.changedTouches[0]?.clientX
                touchX.current = null
                if (start == null || end == null || Math.abs(end - start) < 50) return
                go(end < start ? 1 : -1)
              }}
            >
              <Image
                key={show.photos[open.photo]}
                src={show.photos[open.photo]!}
                alt={`Сцена из спектакля «${show.title}», фото ${open.photo + 1}`}
                fill
                sizes="90vw"
                className={styles.big}
              />
              {count > 1 && (
                <>
                  <button
                    type="button"
                    className={`${styles.nav} ${styles.prev}`}
                    onClick={() => go(-1)}
                    aria-label="Предыдущее фото"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    className={`${styles.nav} ${styles.next}`}
                    onClick={() => go(1)}
                    aria-label="Следующее фото"
                  >
                    →
                  </button>
                </>
              )}
            </div>

            <ul className={styles.thumbs} aria-label="Все фото спектакля">
              {show.photos.map((src, i) => (
                <li key={src}>
                  <button
                    type="button"
                    className={styles.thumb}
                    aria-current={i === open.photo || undefined}
                    aria-label={`Фото ${i + 1}`}
                    onClick={() => setOpen({ ...open, photo: i })}
                  >
                    <Image src={src} alt="" fill sizes="6rem" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </dialog>
    </>
  )
}
