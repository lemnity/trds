import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

import { AboutTeaser } from '@/components/home/AboutTeaser'
import { HeroSlider } from '@/components/home/HeroSlider'
import { NewsList } from '@/components/home/NewsCard'
import { ReviewsShowcase } from '@/components/home/ReviewsShowcase'
import { UpcomingRail } from '@/components/home/UpcomingRail'
import { getSiteContent, getSiteShows } from '@/app/(frontend)/site-data'
import { heroSlides, listUpcoming } from '@/modules/shows'

import styles from './home.module.css'
import { buttonVariants } from '@heroui/styles'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { cardClass } from '@/components/ui/card'

export const metadata: Metadata = { alternates: { canonical: '/' } }

const HERO_NEAREST = 4
/** На главной — последние новости, остальные в архиве /news. */
const HOME_NEWS = 4

export default async function HomePage() {
  const [data, { news, partners, reviews }] = await Promise.all([getSiteShows(), getSiteContent()])
  const upcoming = listUpcoming(data, new Date())
  const posters = new Map(data.shows.map((s) => [s.slug, s.previewUrl ?? s.posterUrl]))
  // Слайд — превью спектакля (368×250, если театр его передал), иначе обложка.
  const covers = new Map(data.shows.map((s) => [s.slug, s.previewUrl ?? s.posterUrl]))
  const slides = heroSlides(data, new Date(), HERO_NEAREST).map((performance) => ({
    performance,
    imageUrl: covers.get(performance.show.slug)!,
  }))
  const bannerPoster = posters.get('guests')

  return (
    <>
      <section className={`container ${styles.heroWrap}`} aria-labelledby="hero-title">
        <h1 id="hero-title" className="visually-hidden">
          Модный театр TURDUS — повод выйти в свет
        </h1>
        <HeroSlider slides={slides} />
      </section>

      <section className={`container ${styles.section}`} aria-labelledby="upcoming-title">
        {/* Все предстоящие показы: лента сама берёт ближайший показ каждого спектакля. */}
        <UpcomingRail
          headClassName={styles.sectionHead}
          title={
            <h2 id="upcoming-title" className={styles.sectionTitle}>
              Ближайшие спектакли
            </h2>
          }
          more={
            <Link href="/afisha" className={styles.more}>
              Вся афиша
            </Link>
          }
          items={upcoming.flatMap((item) => {
            const posterUrl = posters.get(item.show.slug)
            return posterUrl ? [{ item, posterUrl }] : []
          })}
        />
      </section>

      <section className={`container ${styles.section}`} aria-labelledby="about-title">
        <AboutTeaser />
      </section>

      <section className={`container ${styles.section}`} aria-labelledby="news-title">
        <div className={styles.sectionHead}>
          <h2 id="news-title" className={styles.sectionTitle}>
            Новости
          </h2>
          <ButtonLink href="/news" variant="outline">
            Архив новостей
          </ButtonLink>
        </div>
        <NewsList items={news.slice(0, HOME_NEWS)} />
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
            <Link
              href="/corporate"
              className={buttonVariants({ variant: 'outline', className: styles.onDark })}
            >
              Оставить заявку
            </Link>
          </div>
          {bannerPoster && (
            <div className={styles.bannerMedia}>
              <Image src={bannerPoster} alt="" fill sizes="(min-width: 60rem) 50vw, 100vw" />
            </div>
          )}
        </div>
      </section>

      <section
        id="partners"
        className={`container ${styles.section}`}
        aria-labelledby="partners-title"
      >
        <h2 id="partners-title" className={styles.sectionTitle}>
          Партнёры и площадки
        </h2>
        {/* Логотипы партнёров театр ещё не передал — пока названия. */}
        <ul className={styles.partners}>
          {partners.map((p) => (
            <li key={p.name} className={cardClass(styles.partner)}>
              <span className={styles.partnerName}>{p.name}</span>
              <span className={styles.partnerRole}>{p.role}</span>
            </li>
          ))}
        </ul>
      </section>

      <section
        id="reviews"
        className={`container ${styles.section}`}
        aria-labelledby="reviews-title"
      >
        <ReviewsShowcase reviews={reviews} />
      </section>
    </>
  )
}
