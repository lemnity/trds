import Image from 'next/image'
import Link from 'next/link'

import {
  formatAge,
  formatDuration,
  formatPerformanceDate,
  type SalePerformance,
  type Show,
} from '@/modules/shows'

import buttons from '../ui/button.module.css'
import styles from './ShowHeader.module.css'

const CalendarIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
    <rect
      x="3"
      y="4.5"
      width="14"
      height="12"
      rx="2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M3 8.5h14M7 3v3M13 3v3"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
)

const PinIcon = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
    <path
      d="M10 17.5s5.5-5 5.5-9.25a5.5 5.5 0 0 0-11 0C4.5 12.5 10 17.5 10 17.5Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <circle cx="10" cy="8.25" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

export function ShowHeader({ show, next }: { show: Show; next: SalePerformance | undefined }) {
  // Баннер — фото со спектакля; если фото нет, используем афишу.
  const banner = show.gallery[0] ?? show.posterUrl
  const date = next ? formatPerformanceDate(next.startsAt) : null
  const chips = [show.genre, formatAge(show.ageLimit), formatDuration(show.durationMinutes)].filter(
    (c): c is string => c !== null,
  )

  return (
    <div className="container">
      <div className={styles.banner}>
        <Image src={banner} alt="" fill priority sizes="(min-width: 82rem) 82rem, 100vw" />
      </div>

      <nav aria-label="Хлебные крошки" className={styles.crumbs}>
        <ol>
          <li>
            <Link href="/">Главная</Link>
          </li>
          <li>
            <Link href="/afisha">Афиша</Link>
          </li>
          <li aria-current="page">{show.title}</li>
        </ol>
      </nav>

      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>{show.title}</h1>
          {chips.length > 0 && (
            <ul className={styles.chips} aria-label="О спектакле кратко">
              {chips.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          {next && date && (
            <p className={styles.meta}>
              <span>
                <CalendarIcon /> {date.longDate}, {date.time}
              </span>
              <span>
                <PinIcon /> {next.venue.title}
              </span>
            </p>
          )}
          {next ? (
            <a href="#tickets" className={`${buttons.button} ${styles.buy}`}>
              Купить билет <span aria-hidden="true">→</span>
            </a>
          ) : (
            <p className={styles.noDates}>Даты появятся позже</p>
          )}
        </div>
        <p className={styles.lead}>{show.lead}</p>
      </div>
    </div>
  )
}
