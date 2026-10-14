import Link from 'next/link'

import { formatRub } from '@/lib/money'
import { formatAge, formatPerformanceDate, type PerformanceView } from '@/modules/shows'

import { Availability } from '../ui/Availability'
import { PremiereBadge } from '../ui/PremiereBadge'
import { VenueTag } from '../ui/VenueTag'
import styles from './Board.module.css'

type Props = {
  item: PerformanceView
  highlight?: boolean
  /** На странице спектакля название не повторяем. */
  showTitle?: boolean
}

export function BoardRow({ item, highlight = false, showTitle = true }: Props) {
  const date = formatPerformanceDate(item.startsAt)
  const age = formatAge(item.show.ageLimit)

  return (
    <article className={`${styles.row} ${highlight ? styles.highlight : ''}`}>
      <div className={styles.date}>
        <span className={styles.day}>{date.day}</span>
        <span className={styles.month}>
          {date.month}, {date.weekday}
        </span>
      </div>
      <p className={styles.time}>
        <span className="visually-hidden">Начало в </span>
        {date.time}
      </p>
      <div className={styles.title}>
        {(highlight || item.show.premiere) && (
          <p className={styles.badges}>
            {highlight && <span className={styles.badge}>Ближайший показ</span>}
            {item.show.premiere && <PremiereBadge />}
          </p>
        )}
        {showTitle ? (
          <h3>
            <Link href={`/shows/${item.show.slug}`}>{item.show.title}</Link>
          </h3>
        ) : null}
        <p className={styles.genre}>
          {showTitle ? [item.show.genre, age].filter(Boolean).join(' · ') : item.venue.address}
        </p>
      </div>
      <div className={styles.venue}>
        <VenueTag kind={item.venue.kind} />
        <span>{item.venue.title}</span>
      </div>
      <div className={styles.action}>
        {item.salesOpen && item.minPriceKopecks !== null && item.availability?.level !== 'none' ? (
          <>
            <span className={styles.price}>
              от {formatRub(item.minPriceKopecks)}
              {item.pricePlaceholder && <span className={styles.placeholder}>предварительно</span>}
            </span>
            <Link href={`/shows/${item.show.slug}?date=${item.id}#tickets`} className={styles.cta}>
              Билеты
              <span className="visually-hidden">
                {' '}
                на «{item.show.title}», {date.longDate}
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          </>
        ) : null}
        <div className={styles.availability}>
          <Availability availability={item.availability} />
        </div>
      </div>
    </article>
  )
}
