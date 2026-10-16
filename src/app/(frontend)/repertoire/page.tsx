import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

import { formatAge, formatPerformanceDate, getShowsData, listUpcoming } from '@/modules/shows'

import head from '../page-head.module.css'
import { reveal } from '@/components/ui/reveal'
import styles from '../theatre.module.css'

export const metadata: Metadata = {
  title: 'Репертуар',
  description: 'Все спектакли модного театра TURDUS.',
}

/** Репертуар: все опубликованные спектакли с жанром, возрастом и ближайшим показом. */
export default function RepertoirePage() {
  const data = getShowsData()
  const upcoming = listUpcoming(data, new Date())
  const shows = data.shows
    .filter((s) => s.status === 'published')
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
  return (
    <div className="container">
      <header className={head.head}>
        <h1 className={head.title}>Репертуар</h1>
        <p className={head.lead}>Спектакли, которые идут сейчас. Даты — в афише.</p>
      </header>
      <ul className={styles.grid}>
        {shows.map((show, i) => {
          const next = upcoming.find((p) => p.show.slug === show.slug)
          const date = next ? formatPerformanceDate(next.startsAt) : null
          return (
            <li key={show.slug} className={styles.card} {...reveal(i % 4)}>
              <div className={styles.media}>
                <Image src={show.posterUrl} alt="" fill sizes="(min-width: 64rem) 30vw, 100vw" />
              </div>
              <p className={styles.kicker}>
                {[show.genre, formatAge(show.ageLimit)].filter(Boolean).join(' · ')}
              </p>
              <h2 className={styles.name}>
                <Link href={`/shows/${show.slug}`}>{show.title}</Link>
              </h2>
              <p className={styles.note}>
                {date && next
                  ? `Ближайший показ: ${date.longDate}, ${date.time} · ${next.venue.title}`
                  : 'Даты появятся позже'}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
