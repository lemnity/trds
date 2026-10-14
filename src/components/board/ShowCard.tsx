import Image from 'next/image'
import Link from 'next/link'

import { formatAge, formatPerformanceDate, type PerformanceView } from '@/modules/shows'

import styles from './ShowCard.module.css'

export function ShowCard({ item, posterUrl }: { item: PerformanceView; posterUrl: string }) {
  const date = formatPerformanceDate(item.startsAt)
  return (
    <article className={styles.card}>
      <div className={styles.media}>
        <Image
          src={posterUrl}
          alt=""
          fill
          sizes="(min-width: 60rem) 25vw, (min-width: 36rem) 50vw, 100vw"
        />
      </div>
      <div className={styles.body}>
        <p className={styles.meta}>
          <span>
            {date.longDate}, {date.time}
          </span>
          <span aria-hidden="true" className={styles.arrow}>
            →
          </span>
        </p>
        <h3 className={styles.title}>
          <Link href={`/shows/${item.show.slug}`}>{item.show.title}</Link>
        </h3>
        <p className={styles.genre}>
          {[item.show.genre, formatAge(item.show.ageLimit)].filter(Boolean).join(' · ')}
        </p>
      </div>
    </article>
  )
}
