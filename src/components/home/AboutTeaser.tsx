import Link from 'next/link'

import { getSiteContent, getSiteShows } from '@/app/(frontend)/site-data'
import { VENUE_KIND_LABELS, type VenueKind } from '@/modules/shows'

import { ButtonLink } from '../ui/ButtonLink'
import styles from './AboutTeaser.module.css'
import { PhotoMarquee, type MarqueePhoto } from './PhotoMarquee'

/** Площадки, где играет театр, — фильтры афиши («сцена — везде»). */
const VENUES: VenueKind[] = ['stage', 'bar', 'restaurant', 'loft', 'apartment', 'city']

/**
 * «О театре» на главной: крупная фраза и абзац на 12-колоночной сетке, бесконечная лента фото,
 * строка «Где мы играем» — площадки ведут в афишу с фильтром. Тексты — с сайта театра.
 */
export async function AboutTeaser() {
  const [data, { aboutTheatre }] = await Promise.all([getSiteShows(), getSiteContent()])
  // Фото театра и по одному кадру из галереи каждого спектакля — длинная лента.
  const photos: MarqueePhoto[] = [
    ...aboutTheatre.photos.map((src) => ({ src, alt: 'Модный театр TURDUS на сцене' })),
    ...data.shows.flatMap((show) =>
      show.gallery[0] ? [{ src: show.gallery[0], alt: `Сцена из спектакля «${show.title}»` }] : [],
    ),
  ]
  return (
    <div className={styles.about}>
      <div className={styles.intro}>
        <div className={styles.statement}>
          {/* Надзаголовка нет: заголовок секции — сама фраза. */}
          <h2 id="about-title" className={styles.lead}>
            {aboutTheatre.lead}
          </h2>
        </div>
        <div className={styles.text}>
          <p>{aboutTheatre.paragraphs[0]}</p>
          <ButtonLink href="/about">Подробнее о театре</ButtonLink>
        </div>
      </div>

      <PhotoMarquee photos={photos} />

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
