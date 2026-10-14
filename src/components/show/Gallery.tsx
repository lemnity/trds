'use client'

import Image from 'next/image'
import { useRef, useState, type KeyboardEvent } from 'react'

import styles from './Gallery.module.css'

/**
 * Слайдер фото: прокрутка со snap (свайп на телефоне), кнопки и стрелки клавиатуры.
 * Паттерн WAI-ARIA Carousel без автопрокрутки.
 */
export function Gallery({ photos, title }: { photos: string[]; title: string }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(photos.length - 1, next))
    const track = trackRef.current
    track?.children[clamped]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'start',
    })
    setIndex(clamped)
  }

  const onScroll = () => {
    const track = trackRef.current
    if (!track) return
    setIndex(Math.round(track.scrollLeft / track.clientWidth))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') go(index + 1)
    else if (event.key === 'ArrowLeft') go(index - 1)
    else return
    event.preventDefault()
  }

  return (
    <section
      className={styles.gallery}
      aria-roledescription="карусель"
      aria-label={`Фото спектакля «${title}»`}
      onKeyDown={onKeyDown}
    >
      <div ref={trackRef} className={styles.track} onScroll={onScroll} tabIndex={0}>
        {photos.map((src, i) => (
          <figure
            key={src}
            className={styles.slide}
            role="group"
            aria-roledescription="слайд"
            aria-label={`${i + 1} из ${photos.length}`}
          >
            <Image
              src={src}
              alt={`Сцена из спектакля «${title}», фото ${i + 1}`}
              fill
              sizes="(min-width: 60rem) 60vw, 100vw"
            />
          </figure>
        ))}
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          onClick={() => go(index - 1)}
          aria-disabled={index === 0}
          aria-label="Предыдущее фото"
        >
          <span aria-hidden="true">←</span>
        </button>
        <p className={styles.counter} aria-live="polite">
          {index + 1} / {photos.length}
        </p>
        <button
          type="button"
          onClick={() => go(index + 1)}
          aria-disabled={index === photos.length - 1}
          aria-label="Следующее фото"
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  )
}
