'use client'

import { Button } from '@heroui/react'
import { useState } from 'react'

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
 * «Отзывы» (варианты А + В с холста): тёмная полоса; слева крупная выдержка и полный
 * текст, справа «Кто говорит». Все отзывы лежат в одной ячейке сетки — высота блока по
 * самому длинному, при переключении ничего не прыгает. Без автопрокрутки.
 */
export function ReviewsShowcase({ reviews }: { reviews: Review[] }) {
  const [current, setCurrent] = useState(0)
  const go = (next: number) => setCurrent((next + reviews.length) % reviews.length)

  return (
    <div className={styles.band}>
      <div className={styles.head}>
        <h2 id="reviews-title" className={styles.title}>
          Отзывы
        </h2>
        <div className={`${styles.controls} on-dark`}>
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

      <div className={styles.body}>
        <div className={styles.stack}>
          {reviews.map((review, i) => (
            <figure
              key={review.id}
              className={styles.review}
              data-active={i === current || undefined}
              aria-hidden={i !== current || undefined}
              inert={i !== current || undefined}
            >
              <span className={styles.mark} aria-hidden="true">
                “
              </span>
              <p className={styles.lead}>{review.lead}</p>
              <blockquote className={styles.quote}>
                <p>{review.quote}</p>
              </blockquote>
              <figcaption className="visually-hidden">
                {review.author}, {review.role}
              </figcaption>
            </figure>
          ))}
        </div>

        <div className={styles.who}>
          <p className={styles.whoLabel} id="reviews-who">
            Кто говорит
          </p>
          <ul aria-labelledby="reviews-who" className={styles.people}>
            {reviews.map((review, i) => (
              <li key={review.id}>
                <button
                  type="button"
                  className={styles.person}
                  aria-pressed={i === current}
                  onClick={() => setCurrent(i)}
                >
                  <span className={styles.marker} aria-hidden="true" />
                  <span className={styles.personText}>
                    <span className={styles.personName}>{review.author}</span>
                    <span className={styles.personRole}>{review.role}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
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
