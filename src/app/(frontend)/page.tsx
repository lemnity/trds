import { Chip } from '@heroui/react'
import Image from 'next/image'
import Link from 'next/link'

import { HideWhenStarted } from '@/components/board/HideWhenStarted'
import { ShowCard } from '@/components/board/ShowCard'
import { HeroSlider } from '@/components/home/HeroSlider'
import { aboutTheatre, news, partners } from '@/modules/content'
import { getShowsData, heroSlides, listUpcoming, type PerformanceView } from '@/modules/shows'

import styles from './home.module.css'
import { buttonVariants } from '@heroui/styles'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { cardClass } from '@/components/ui/card'

const CARDS = 4
const HERO_NEAREST = 4

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
        <div className={styles.sectionHead}>
          <h2 id="upcoming-title" className={styles.sectionTitle}>
            Ближайшие спектакли
          </h2>
          <Link href="/afisha" className={styles.more}>
            Вся афиша
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
        <h2 id="news-title" className={styles.sectionTitle}>
          Новости
        </h2>
        <ul className={styles.news}>
          {news.map((item) => (
            <li key={item.id}>
              <article className={cardClass(styles.newsCard)}>
                <div className={styles.newsMedia}>
                  <Image src={item.imageUrl} alt="" fill sizes="(min-width: 60rem) 25vw, 100vw" />
                </div>
                <div className={styles.newsBody}>
                  <Chip size="sm" variant="soft" className={styles.newsTag}>
                    {item.tag}
                  </Chip>
                  <h3 className={styles.newsTitle}>
                    <Link href={item.href}>{item.title}</Link>
                  </h3>
                  <p className={styles.newsSummary}>{item.summary}</p>
                </div>
              </article>
            </li>
          ))}
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
    </>
  )
}
