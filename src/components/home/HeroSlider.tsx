'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState, useSyncExternalStore, type KeyboardEvent } from 'react'

import { formatRub } from '@/lib/money'
import { formatAge, formatPerformanceDate, type PerformanceView } from '@/modules/shows'

import buttons from '../ui/button.module.css'
import { PremiereBadge } from '../ui/PremiereBadge'
import styles from './HeroSlider.module.css'

export type HeroSlide = { performance: PerformanceView; imageUrl: string }

const noopSubscribe = () => () => {}
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Главный экран — слайды ближайших показов и премьер. Без автопрокрутки
 * (WCAG 2.2.2): листание кнопками, точками, свайпом и стрелками клавиатуры.
 */
export function HeroSlider({ slides }: { slides: HeroSlide[] }) {
  // Статическая сборка: начавшиеся показы убираем уже в браузере.
  const startedKey = useSyncExternalStore(
    noopSubscribe,
    () =>
      slides
        .filter((s) => Date.parse(s.performance.startsAt) <= Date.now())
        .map((s) => s.performance.id)
        .join(','),
    () => '',
  )
  const started = new Set(startedKey.split(',').filter(Boolean))
  const visible = slides.filter((s) => !started.has(s.performance.id))
  const [index, setIndex] = useState(0)
  const [touchX, setTouchX] = useState<number | null>(null)

  if (visible.length === 0) return null
  const current = Math.min(index, visible.length - 1)
  const go = (next: number) => setIndex((next + visible.length) % visible.length)

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') go(current + 1)
    else if (event.key === 'ArrowLeft') go(current - 1)
    else return
    event.preventDefault()
  }

  return (
    <section
      className={styles.slider}
      aria-roledescription="карусель"
      aria-label="Ближайшие показы и премьеры"
      onKeyDown={onKeyDown}
      onTouchStart={(e) => setTouchX(e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const end = e.changedTouches[0]?.clientX
        if (touchX !== null && end !== undefined && Math.abs(end - touchX) > 40)
          go(end < touchX ? current + 1 : current - 1)
        setTouchX(null)
      }}
    >
      {visible.map(({ performance: p, imageUrl }, i) => {
        const date = formatPerformanceDate(p.startsAt)
        const active = i === current
        return (
          <article
            key={p.id}
            className={styles.slide}
            data-active={active}
            aria-roledescription="слайд"
            aria-label={`${i + 1} из ${visible.length}: ${p.show.title}`}
            aria-hidden={!active}
            inert={!active}
          >
            <div className={styles.media}>
              <Image
                src={imageUrl}
                alt=""
                fill
                priority={i === 0}
                sizes="(min-width: 60rem) 70vw, 100vw"
              />
            </div>
            <div className={styles.content}>
              <div className={styles.badges}>
                {p.show.premiere && <PremiereBadge />}
                <span className={styles.when}>
                  {date.longDate}, {date.weekday} · {date.time}
                </span>
              </div>
              <h2 className={styles.title}>{p.show.title}</h2>
              <p className={styles.meta}>
                {[p.show.genre, formatAge(p.show.ageLimit), p.venue.title]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className={styles.actions}>
                <Link
                  href={`/shows/${p.show.slug}?date=${p.id}#tickets`}
                  className={buttons.button}
                >
                  {p.salesOpen ? 'Купить билет' : 'Подробнее о показе'}{' '}
                  <span aria-hidden="true">→</span>
                </Link>
                {p.salesOpen && p.minPriceKopecks !== null && (
                  <span className={styles.price}>от {formatRub(p.minPriceKopecks)}</span>
                )}
              </div>
            </div>
          </article>
        )
      })}

      {visible.length > 1 && (
        <div className={styles.controls}>
          <p className={styles.counter} aria-live="polite">
            <span className={styles.counterCurrent}>{pad(current + 1)}</span> /{' '}
            {pad(visible.length)}
          </p>
          <div className={styles.dots} role="group" aria-label="Выбор слайда">
            {visible.map((s, i) => (
              <button
                key={s.performance.id}
                type="button"
                aria-label={`Слайд ${i + 1}: ${s.performance.show.title}`}
                aria-current={i === current}
                onClick={() => go(i)}
              />
            ))}
          </div>
          <div className={styles.arrows}>
            <button type="button" onClick={() => go(current - 1)} aria-label="Предыдущий слайд">
              <span aria-hidden="true">←</span>
            </button>
            <button type="button" onClick={() => go(current + 1)} aria-label="Следующий слайд">
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
