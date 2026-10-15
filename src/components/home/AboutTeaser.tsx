import Image from 'next/image'
import Link from 'next/link'

import { aboutTheatre } from '@/modules/content'
import { VENUE_KIND_LABELS, type VenueKind } from '@/modules/shows'

import { ButtonLink } from '../ui/ButtonLink'
import styles from './AboutTeaser.module.css'

/** Площадки, где играет театр, — фильтры афиши («сцена — везде»). */
const VENUES: VenueKind[] = ['stage', 'bar', 'restaurant', 'loft', 'apartment', 'city']

/**
 * «О театре» на главной: крупная фраза и абзац на 12-колоночной сетке, мозаика из трёх фото,
 * строка «Где мы играем» — площадки ведут в афишу с фильтром. Тексты — с сайта театра.
 */
export function AboutTeaser() {
  const [wide, ...rest] = aboutTheatre.photos
  return (
    <div className={styles.about}>
      <div className={styles.intro}>
        <div className={styles.statement}>
          <h2 id="about-title" className={styles.label}>
            {aboutTheatre.title}
          </h2>
          <p className={styles.lead}>{aboutTheatre.lead}</p>
        </div>
        <div className={styles.text}>
          <p>{aboutTheatre.paragraphs[0]}</p>
          <ButtonLink href="/about">Подробнее о театре</ButtonLink>
        </div>
      </div>

      <div className={styles.mosaic}>
        {wide && (
          <div className={`${styles.photo} ${styles.photoWide}`}>
            <Image
              src={wide}
              alt="Спектакль модного театра TURDUS"
              fill
              sizes="(min-width: 60rem) 50vw, 100vw"
            />
          </div>
        )}
        {rest.slice(0, 2).map((src) => (
          <div key={src} className={styles.photo}>
            <Image
              src={src}
              alt="Актёры модного театра TURDUS"
              fill
              sizes="(min-width: 60rem) 25vw, 50vw"
            />
          </div>
        ))}
      </div>

      <div className={styles.venues}>
        <p className={styles.venuesTitle} id="about-venues">
          Где мы играем
        </p>
        <ul aria-labelledby="about-venues" className={styles.venueList}>
          {VENUES.map((kind) => (
            <li key={kind}>
              <Link href={`/afisha?kind=${kind}`} className={styles.venue}>
                {VENUE_KIND_LABELS[kind]}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
