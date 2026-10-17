'use client'

import Image from 'next/image'
import { useEffect, useState, useSyncExternalStore } from 'react'

import styles from './Auth.module.css'

const INTERVAL = 5000

const subscribeMotion = (cb: () => void) => {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/**
 * Слайд-шоу кадров спектаклей в левой панели входа: смена каждые 5 с с кроссфейдом и медленным
 * наездом. Пауза кнопкой (WCAG 2.2.2) и при наведении; при reduced motion — статичный первый кадр.
 */
export function AuthSlideshow({ photos }: { photos: { src: string; title: string }[] }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hover, setHover] = useState(false)
  const still = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  )
  const running = !paused && !hover && !still && photos.length > 1

  useEffect(() => {
    if (!running) return
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % photos.length), INTERVAL)
    return () => window.clearTimeout(id)
  }, [running, index, photos.length])

  const current = photos[index]

  return (
    <div
      className={styles.slides}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {photos.map((photo, i) => (
        <div
          key={photo.src}
          className={styles.slide}
          data-active={i === index || undefined}
          data-still={still || undefined}
          aria-hidden="true"
        >
          <Image
            src={photo.src}
            alt=""
            fill
            priority={i === 0}
            sizes="(min-width: 60rem) 45vw, 100vw"
          />
        </div>
      ))}
      {photos.length > 1 && (
        <div className={styles.slideBar}>
          <span className={styles.slideCaption} aria-live="off">
            {current?.title}
          </span>
          <div className={styles.slideDots} aria-hidden="true">
            {photos.map((photo, i) => (
              <i key={photo.src} data-on={i === index || undefined} />
            ))}
          </div>
          {!still && (
            <button
              type="button"
              className={styles.slidePause}
              aria-pressed={paused}
              aria-label={paused ? 'Продолжить слайд-шоу' : 'Остановить слайд-шоу'}
              onClick={() => setPaused(!paused)}
            >
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                {paused ? (
                  <path d="M6 4l10 6-10 6V4Z" fill="currentColor" />
                ) : (
                  <path d="M6 4h3v12H6zM11 4h3v12h-3z" fill="currentColor" />
                )}
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
