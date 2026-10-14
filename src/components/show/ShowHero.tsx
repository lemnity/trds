import Image from 'next/image'

import {
  formatAge,
  formatDuration,
  formatPerformanceDate,
  type SalePerformance,
  type Show,
} from '@/modules/shows'

import buttons from '../ui/button.module.css'
import styles from './ShowHero.module.css'

export function ShowHero({ show, next }: { show: Show; next: SalePerformance | undefined }) {
  const date = next ? formatPerformanceDate(next.startsAt) : null
  const chips = [
    ['Ближайший показ', date?.longDate ?? null],
    ['Начало', date?.time ?? null],
    ['Длительность', formatDuration(show.durationMinutes)],
    ['Площадка', next?.venue.title ?? null],
  ].filter((c): c is [string, string] => c[1] !== null)

  return (
    <section className={styles.hero} aria-labelledby="show-title">
      <div className={styles.media}>
        <Image src={show.posterUrl} alt="" fill priority sizes="100vw" />
      </div>
      <div className={`container ${styles.content}`}>
        <p className={styles.eyebrow}>
          {[show.genre, formatAge(show.ageLimit)].filter(Boolean).join(' · ')}
        </p>
        <h1 id="show-title" className={styles.title}>
          {show.title}
        </h1>
        <p className={styles.lead}>{show.lead}</p>
        <div className={styles.actions}>
          {next && (
            <a href="#tickets" className={buttons.button}>
              Выбрать билеты <span aria-hidden="true">→</span>
            </a>
          )}
          <a href="#about" className={`${buttons.button} ${buttons.ghost}`}>
            О спектакле
          </a>
        </div>
        {chips.length > 0 && (
          <dl className={styles.chips}>
            {chips.map(([term, value]) => (
              <div key={term} className={styles.chip}>
                <dt>{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  )
}
