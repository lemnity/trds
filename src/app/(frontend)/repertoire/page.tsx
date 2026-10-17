import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

import { PageTabs } from '@/components/ui/PageTabs'
import { reveal } from '@/components/ui/reveal'
import { personSlug } from '@/modules/people'
import { formatAge, formatPerformanceDate, getShowsData, listUpcoming } from '@/modules/shows'

import head from '../page-head.module.css'
import styles from '../theatre.module.css'

export const metadata: Metadata = {
  title: 'Репертуар',
  description: 'Спектакли модного театра TURDUS — идущие сейчас и архив прошедших постановок.',
}

/**
 * Репертуар: вкладки «Действующие» (опубликованные спектакли с ближайшим показом) и «Архив»
 * (прошедшие постановки с сайта театра; состав — где он указан, имена ведут на страницы людей).
 */
export default function RepertoirePage() {
  const data = getShowsData()
  const upcoming = listUpcoming(data, new Date())
  const shows = data.shows
    .filter((s) => s.status === 'published')
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
  const archive = data.archive ?? []

  const current = (
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
  )

  const past = (
    <ul className={styles.grid}>
      {archive.map((show, i) => (
        <li key={show.slug} className={`${styles.card} ${styles.past}`} {...reveal(i % 4)}>
          <div className={styles.media}>
            <Image src={show.posterUrl} alt="" fill sizes="(min-width: 64rem) 30vw, 100vw" />
          </div>
          {show.genre && <p className={styles.kicker}>{show.genre}</p>}
          <h2 className={styles.pastTitle}>{show.title}</h2>
          {show.credits.length > 0 && (
            <dl className={styles.credits}>
              {show.credits.map((credit) => (
                <div key={credit.role}>
                  <dt>{credit.role}</dt>
                  <dd>
                    {credit.entries.map((entry, k) => (
                      <span key={k}>
                        {k > 0 && ', '}
                        {entry.character && `${entry.character} — `}
                        {entry.people.map((name, j) => (
                          <span key={name}>
                            {j > 0 && ' / '}
                            <Link href={`/people/${personSlug(name)}`}>{name}</Link>
                          </span>
                        ))}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  )

  return (
    <div className="container">
      <header className={head.head}>
        <h1 className={head.title}>Репертуар</h1>
        <p className={head.lead}>Спектакли, которые идут сейчас, и постановки прошлых сезонов.</p>
      </header>
      <PageTabs
        label="Репертуар"
        tabs={[
          { id: 'current', label: 'Действующие', count: shows.length, panel: current },
          { id: 'archive', label: 'Архив', count: archive.length, panel: past },
        ]}
      />
    </div>
  )
}
