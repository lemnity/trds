'use client'

import { Button } from '@heroui/react'
import Image from 'next/image'
import { useState, useSyncExternalStore, type KeyboardEvent } from 'react'

import { formatRub } from '@/lib/money'
import { formatAge, formatPerformanceDate, type PerformanceView } from '@/modules/shows'

import { PremiereBadge } from '../ui/PremiereBadge'
import styles from './HeroSlider.module.css'
import { ButtonLink } from '../ui/ButtonLink'
import { TicketIcon } from '../ui/TicketIcon'

export type HeroSlide = { performance: PerformanceView; imageUrl: string }

const noopSubscribe = () => () => {}

const Chevron = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
    <path
      d={dir === 'left' ? 'M12.5 4.5 7 10l5.5 5.5' : 'M7.5 4.5 13 10l-5.5 5.5'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
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
                {/* Дата первой — её место не зависит от бейджа. */}
                <span className={styles.when}>
                  {date.longDate}, {date.weekday} · {date.time}
                </span>
                {p.show.premiere && <PremiereBadge />}
              </div>
              <h2 className={styles.title}>{p.show.title}</h2>
              <p className={styles.meta}>
                {[p.show.genre, formatAge(p.show.ageLimit), p.venue.title]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className={`${styles.actions} on-dark`}>
                <ButtonLink href={`/shows/${p.show.slug}?date=${p.id}#tickets`}>
                  {p.salesOpen ? (
                    <>
                      <TicketIcon /> Купить билет
                    </>
                  ) : (
                    <>Подробнее о показе</>
                  )}
                </ButtonLink>
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
              <Button
                key={s.performance.id}
                variant="ghost"
                isIconOnly
                className={styles.dot}
                aria-label={`Слайд ${i + 1}: ${s.performance.show.title}`}
                aria-current={i === current}
                onPress={() => go(i)}
              />
            ))}
          </div>
          <div className={styles.arrows}>
            <Button
              variant="outline"
              isIconOnly
              className={styles.arrow}
              onPress={() => go(current - 1)}
              aria-label="Предыдущий слайд"
            >
              <Chevron dir="left" />
            </Button>
            <Button
              variant="outline"
              isIconOnly
              className={styles.arrow}
              onPress={() => go(current + 1)}
              aria-label="Следующий слайд"
            >
              <Chevron dir="right" />
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
