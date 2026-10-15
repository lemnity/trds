'use client'

import { Button } from '@heroui/react'
import { useId, useState } from 'react'

import type { Review } from '@/modules/content'

import styles from './ReviewsShowcase.module.css'

const pad = (n: number) => String(n).padStart(2, '0')

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

/**
 * «Отзывы», вариант В с холста: тёмная полоса, одна крупная цитата (дословная выдержка),
 * автор и «Читать отзыв полностью» — полный текст раскрывается на месте. Цитаты лежат в
 * одной ячейке сетки: высота по самой длинной, переключение без скачков. Без автопрокрутки.
 */
export function ReviewsShowcase({ reviews }: { reviews: Review[] }) {
  const ids = useId()
  const [current, setCurrent] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const go = (next: number) => {
    setCurrent((next + reviews.length) % reviews.length)
    setExpanded(false)
  }
  const active = reviews[current]!

  return (
    <div className={styles.band}>
      <div className={styles.head}>
        <h2 id="reviews-title" className={styles.title}>
          Отзывы
        </h2>
        <div className={styles.controls}>
          <p className={styles.counter} aria-live="polite">
            <span className={styles.counterCurrent}>{pad(current + 1)}</span> /{' '}
            {pad(reviews.length)}
          </p>
          <Button
            variant="outline"
            isIconOnly
            className={styles.arrow}
            onPress={() => go(current - 1)}
            aria-label="Предыдущий отзыв"
          >
            <Chevron dir="left" />
          </Button>
          <Button
            variant="outline"
            isIconOnly
            className={styles.arrow}
            onPress={() => go(current + 1)}
            aria-label="Следующий отзыв"
          >
            <Chevron dir="right" />
          </Button>
        </div>
      </div>

      <div className={styles.stage}>
        <div className={styles.stack}>
          {reviews.map((review, i) => (
            <figure
              key={review.id}
              className={styles.review}
              data-active={i === current || undefined}
              aria-hidden={i !== current || undefined}
              inert={i !== current || undefined}
            >
              <blockquote className={styles.lead}>
                <p>«{review.lead}»</p>
              </blockquote>
              <figcaption className={styles.author}>
                <span className={styles.name}>{review.author}</span>
                <span className={styles.role}>{review.role}</span>
              </figcaption>
            </figure>
          ))}
        </div>

        <div className={styles.more}>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={expanded}
            aria-controls={`${ids}-full`}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Свернуть отзыв' : 'Читать отзыв полностью'}
          </button>
        </div>

        <div id={`${ids}-full`} className={styles.full} hidden={!expanded}>
          <p>{active.quote}</p>
        </div>
      </div>

      <div className={styles.progress} aria-hidden="true">
        {reviews.map((review, i) => (
          <span key={review.id} data-active={i === current || undefined} />
        ))}
      </div>
    </div>
  )
}
