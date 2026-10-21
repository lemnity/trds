import type { Metadata } from 'next'
import Link from 'next/link'

import { getShowsData, listUpcoming, plural, VENUE_KIND_LABELS } from '@/modules/shows'

import head from '../page-head.module.css'
import { reveal } from '@/components/ui/reveal'
import styles from '../theatre.module.css'

export const metadata: Metadata = {
  alternates: { canonical: '/venues' },
  title: 'Площадки',
  description: 'Где играет модный театр TURDUS: бары, рестораны, лофт, квартира и город.',
}

/** Площадки театра — из афиши: тип, адрес, сколько показов впереди, ссылка на фильтр. */
export default function VenuesPage() {
  const data = getShowsData()
  const upcoming = listUpcoming(data, new Date())
  return (
    <div className="container">
      <header className={head.head}>
        <h1 className={head.title}>Площадки</h1>
        <p className={head.lead}>
          Театр играет не в зале, а там, где живёт город: в барах, ресторанах, лофте, квартире и на
          улицах.
        </p>
      </header>
      <ul className={styles.grid}>
        {data.venues.map((venue, i) => {
          const count = upcoming.filter((p) => p.venue.id === venue.id).length
          return (
            <li key={venue.id} className={styles.card} {...reveal(i % 4)}>
              <p className={styles.kicker}>{VENUE_KIND_LABELS[venue.kind]}</p>
              <h2 className={styles.name}>
                <Link href={`/afisha?kind=${venue.kind}`}>{venue.title}</Link>
              </h2>
              <p className={styles.meta}>{venue.address}</p>
              <p className={styles.note}>
                {count
                  ? `${count} ${plural(count, 'показ', 'показа', 'показов')} в афише`
                  : 'Ближайших показов нет'}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
