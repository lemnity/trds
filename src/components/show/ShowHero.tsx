import {
  formatAge,
  formatDuration,
  formatPerformanceDate,
  type Credit,
  type SalePerformance,
  type Show,
} from '@/modules/shows'

import { ButtonLink } from '../ui/ButtonLink'
import { PageCrumbs } from '../ui/PageCrumbs'
import { PremiereBadge } from '../ui/PremiereBadge'
import { TicketIcon } from '../ui/TicketIcon'
import { PeopleLinks } from './ShowAbout'
import { PinIcon } from './showHeaderParts'
import styles from './ShowHero.module.css'

type Props = { show: Show; performances: SalePerformance[] }

const names = (credits: Credit[]) => [
  ...new Set(credits.flatMap((c) => c.entries.flatMap((e) => e.people))),
]

const ClockIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <path
      d="M12 7.5V12l3 2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  </svg>
)

/**
 * Шапка спектакля под обложкой (референс заказчика): крупное название; слева автор и
 * режиссёр, справа период показов; под линией — факты в квадратных рамках и кнопка.
 * Только данные спектакля: чего нет (автора, возраста), того и не показываем.
 */
export function ShowHero({ show, performances }: Props) {
  const authors = names(show.credits.filter((c) => /автор|сценарист/i.test(c.role)))
  const directors = names(show.credits.filter((c) => /режисс/i.test(c.role)))
  const first = performances[0]
  const last = performances.at(-1)
  const from = first ? formatPerformanceDate(first.startsAt) : null
  const to = last ? formatPerformanceDate(last.startsAt) : null
  const venues = [...new Set(performances.map((p) => p.venue.title))]
  const duration = formatDuration(show.durationMinutes)
  const age = formatAge(show.ageLimit)
  const salesOpen = performances.some((p) => p.salesOpen)

  return (
    <header className={`container ${styles.hero}`}>
      <PageCrumbs
        items={[
          { label: 'Главная', href: '/' },
          { label: 'Афиша', href: '/afisha' },
          { label: show.title },
        ]}
      />

      <div className={styles.titleRow}>
        {show.premiere && <PremiereBadge />}
        <h1 className={styles.title}>{show.title}</h1>
      </div>

      <div className={styles.meta}>
        <div className={styles.credits}>
          {authors.length > 0 && (
            <p>
              автор <PeopleLinks names={authors} />
            </p>
          )}
          {directors.length > 0 && (
            <p>
              режиссёр <PeopleLinks names={directors} />
            </p>
          )}
          {show.genre && <p className={styles.genre}>{show.genre}</p>}
        </div>
        <div className={styles.when}>
          {from && to ? (
            <>
              <p>{performances.length > 1 ? 'Ближайшие показы' : 'Ближайший показ'}</p>
              <p>
                {first === last || from.longDate === to.longDate
                  ? `${from.longDate}, ${from.time}`
                  : `с ${from.longDate} по ${to.longDate}`}
              </p>
            </>
          ) : (
            <p>Даты появятся позже</p>
          )}
        </div>
      </div>

      <div className={styles.facts}>
        <ul className={styles.factList}>
          {duration && (
            <li className={styles.fact}>
              <span className={styles.box}>
                <ClockIcon />
              </span>
              {duration}
            </li>
          )}
          {age && (
            <li className={styles.fact}>
              <span className={`${styles.box} ${styles.boxText}`}>{age}</span>
              {show.ageLimit !== null && show.ageLimit >= 18 ? 'Только для взрослых' : 'Возраст'}
            </li>
          )}
          {venues.length > 0 && (
            <li className={styles.fact}>
              <span className={styles.box}>
                <PinIcon />
              </span>
              {venues.length === 1 ? venues[0] : `${venues.length} площадки`}
            </li>
          )}
        </ul>
        {first && (
          <ButtonLink href="#tickets" className={styles.cta}>
            {salesOpen ? (
              <>
                <TicketIcon /> Купить билет
              </>
            ) : (
              'Даты и билеты'
            )}
          </ButtonLink>
        )}
      </div>
    </header>
  )
}
