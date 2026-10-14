import Image from 'next/image'
import Link from 'next/link'

import { HideWhenStarted } from '@/components/board/HideWhenStarted'
import { ShowCard } from '@/components/board/ShowCard'
import buttons from '@/components/ui/button.module.css'
import {
  formatPerformanceDate,
  getShowsData,
  listUpcoming,
  type PerformanceView,
} from '@/modules/shows'

import styles from './home.module.css'

const CARDS = 4

/** Ближайший показ каждого спектакля — без повторов одного названия в подборке. */
const nextPerShow = (items: PerformanceView[]) => {
  const seen = new Set<string>()
  return items.filter((p) => !seen.has(p.show.slug) && seen.add(p.show.slug))
}

export default function HomePage() {
  const data = getShowsData()
  const upcoming = listUpcoming(data, new Date())
  const posters = new Map(data.shows.map((s) => [s.slug, s.posterUrl]))
  const featured = nextPerShow(upcoming).slice(0, CARDS)
  const next = upcoming[0]
  const nextDate = next ? formatPerformanceDate(next.startsAt) : null
  const heroPoster = next ? posters.get(next.show.slug) : undefined
  const bannerPoster = posters.get('guests')

  return (
    <>
      <section className={`container ${styles.heroWrap}`} aria-labelledby="hero-title">
        <div className={styles.hero}>
          {heroPoster && (
            <div className={styles.heroMedia}>
              <Image src={heroPoster} alt="" fill priority sizes="(min-width: 60rem) 70vw, 100vw" />
            </div>
          )}
          <div className={styles.heroContent}>
            <span className={styles.rule} aria-hidden="true" />
            <h1 id="hero-title" className={styles.heroTitle}>
              Модный театр TURDUS
            </h1>
            <p className={styles.heroLead}>
              Повод выйти в свет! Иммерсивные спектакли в баре, ресторане, квартире и на улицах
              Екатеринбурга.
            </p>
            <Link href="/afisha" className={buttons.button}>
              Афиша спектаклей <span aria-hidden="true">→</span>
            </Link>
          </div>
          {next && nextDate && (
            <HideWhenStarted startsAt={next.startsAt}>
              <p className={styles.heroCaption}>
                <span>Ближайший показ</span>
                <Link href={`/shows/${next.show.slug}`}>
                  {nextDate.longDate}, {nextDate.time} — {next.show.title}
                </Link>
              </p>
            </HideWhenStarted>
          )}
        </div>
      </section>

      <section className={`container ${styles.section}`} aria-labelledby="upcoming-title">
        <div className={styles.sectionHead}>
          <h2 id="upcoming-title" className={styles.sectionTitle}>
            Ближайшие спектакли
          </h2>
          <Link href="/afisha" className={styles.more}>
            Вся афиша <span aria-hidden="true">→</span>
          </Link>
        </div>
        <ul className={styles.cards}>
          {featured.map((item) => {
            const poster = posters.get(item.show.slug)
            return poster ? (
              <HideWhenStarted key={item.id} startsAt={item.startsAt}>
                <li>
                  <ShowCard item={item} posterUrl={poster} />
                </li>
              </HideWhenStarted>
            ) : null
          })}
        </ul>
      </section>

      <section className={`container ${styles.section}`} aria-labelledby="corporate-title">
        <div className={styles.banner}>
          <div className={styles.bannerContent}>
            <h2 id="corporate-title" className={styles.bannerTitle}>
              Корпоративы с театром
            </h2>
            <p className={styles.bannerLead}>
              Спектакль или перформанс для вашей компании и частных гостей.
            </p>
            {/* Форма заявки — T-034; до неё заявка уходит на почту театра. */}
            <a
              href="mailto:rechevik@inbox.ru?subject=%D0%9A%D0%BE%D1%80%D0%BF%D0%BE%D1%80%D0%B0%D1%82%D0%B8%D0%B2"
              className={`${buttons.button} ${buttons.ghost}`}
            >
              Оставить заявку <span aria-hidden="true">→</span>
            </a>
          </div>
          {bannerPoster && (
            <div className={styles.bannerMedia}>
              <Image src={bannerPoster} alt="" fill sizes="(min-width: 60rem) 50vw, 100vw" />
            </div>
          )}
        </div>
      </section>
    </>
  )
}
