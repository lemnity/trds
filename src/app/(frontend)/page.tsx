import Image from 'next/image'
import Link from 'next/link'

import { HeroSlider } from '@/components/home/HeroSlider'
import { NewsList } from '@/components/home/NewsCard'
import { UpcomingRail } from '@/components/home/UpcomingRail'
import { aboutTheatre, news, partners, reviews } from '@/modules/content'
import { getShowsData, heroSlides, listUpcoming } from '@/modules/shows'

import styles from './home.module.css'
import { buttonVariants } from '@heroui/styles'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { cardClass } from '@/components/ui/card'

const HERO_NEAREST = 4
/** На главной — последние новости, остальные в архиве /news. */
const HOME_NEWS = 4

export default function HomePage() {
  const data = getShowsData()
  const upcoming = listUpcoming(data, new Date())
  const posters = new Map(data.shows.map((s) => [s.slug, s.posterUrl]))
  // Слайд — фото спектакля, если есть, иначе афиша.
  const covers = new Map(data.shows.map((s) => [s.slug, s.gallery[0] ?? s.posterUrl]))
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
        <div className={styles.about}>
          <div className={styles.aboutText}>
            <h2 id="about-title" className={styles.sectionTitle}>
              {aboutTheatre.title}
            </h2>
            <p className={styles.aboutLead}>{aboutTheatre.lead}</p>
            <p>{aboutTheatre.paragraphs[0]}</p>
            <ButtonLink href="/about" className={styles.aboutButton}>
              Подробнее
            </ButtonLink>
          </div>
          <div className={styles.aboutPhotos}>
            {aboutTheatre.photos.slice(0, 2).map((src) => (
              <div key={src} className={styles.aboutPhoto}>
                <Image
                  src={src}
                  alt="Команда модного театра TURDUS"
                  fill
                  sizes="(min-width: 60rem) 25vw, 50vw"
                />
              </div>
            ))}
          </div>
        </div>
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
            {/* Форма заявки — T-034; до неё заявка уходит на почту театра. */}
            <a
              href="mailto:rechevik@inbox.ru?subject=%D0%9A%D0%BE%D1%80%D0%BF%D0%BE%D1%80%D0%B0%D1%82%D0%B8%D0%B2"
              className={buttonVariants({ variant: 'outline', className: styles.onDark })}
            >
              Оставить заявку
            </a>
          </div>
          {bannerPoster && (
            <div className={styles.bannerMedia}>
              <Image src={bannerPoster} alt="" fill sizes="(min-width: 60rem) 50vw, 100vw" />
            </div>
          )}
        </div>
      </section>

      <section className={`container ${styles.section}`} aria-labelledby="partners-title">
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

      <section className={`container ${styles.section}`} aria-labelledby="reviews-title">
        <h2 id="reviews-title" className={styles.sectionTitle}>
          Отзывы
        </h2>
        <ul className={styles.reviews}>
          {reviews.map((review) => (
            <li key={review.id}>
              <figure className={styles.review}>
                <span className={styles.quoteMark} aria-hidden="true">
                  “
                </span>
                <figcaption className={styles.reviewAuthor}>
                  <span className={styles.reviewName}>{review.author}</span>
                  <span className={styles.reviewRole}>{review.role}</span>
                </figcaption>
                <blockquote className={styles.quote}>
                  <p>{review.quote}</p>
                </blockquote>
              </figure>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
