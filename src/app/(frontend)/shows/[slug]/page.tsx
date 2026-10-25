import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { pageOpenGraph } from '@/lib/site'
import { Suspense } from 'react'

import { HideWhenStarted } from '@/components/board/HideWhenStarted'
import { ShowCard } from '@/components/board/ShowCard'
import { ShowBooking } from '@/components/show/ShowBooking'
import { Gallery, showGalleryItems } from '@/components/show/Gallery'
import { ShowAbout } from '@/components/show/ShowAbout'
import { ShowBuy, ShowCover } from '@/components/show/ShowHeaderCompact'
import { ShowHero } from '@/components/show/ShowHero'
import {
  getPersonPhotos,
  getSiteShows,
  staticExportOnly,
  staticShowsData,
} from '@/app/(frontend)/site-data'
import { getShowPage, listPublishedShows, listUpcoming } from '@/modules/shows'

import styles from './show.module.css'

type Params = { slug: string }

// Статическая сборка — спектакли демо-набора; на сервере — по запросу, из CMS.
export const generateStaticParams = staticExportOnly((): Params[] => {
  const data = staticShowsData()
  return data ? listPublishedShows(data).map((s) => ({ slug: s.slug })) : []
})

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params
  const page = getShowPage(await getSiteShows(), slug, new Date())
  // notFound() здесь, а не только в странице: метаданные для роботов блокирующие — ответ 404.
  if (!page) notFound()
  const { seo } = page.show
  return {
    title: seo?.title ?? page.show.title,
    description: seo?.description ?? page.show.lead,
    alternates: { canonical: `/shows/${page.show.slug}` },
    // Обложка спектакля — горизонтальная 16:9, подходит для карточки ссылки в мессенджерах.
    openGraph: pageOpenGraph(
      page.show.title,
      seo?.imageUrl ?? page.show.posterUrl,
      seo?.description ?? page.show.lead,
    ),
  }
}

const OTHER_SHOWS = 4

export default async function ShowPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const [data, personPhotos] = await Promise.all([getSiteShows(), getPersonPhotos()])
  const now = new Date()
  const page = getShowPage(data, slug, now)
  if (!page) notFound()
  const { show, performances } = page

  const posters = new Map(data.shows.map((s) => [s.slug, s.previewUrl ?? s.posterUrl]))
  const seen = new Set([slug])
  const others = listUpcoming(data, now)
    .filter((p) => !seen.has(p.show.slug) && seen.add(p.show.slug))
    .slice(0, OTHER_SHOWS)
  // Старый сайт театра: на нём продажи через Ticketscloud, пока не подключён банк.
  const fallbackUrl = `https://teatrturdus.ru/${show.slug}`

  return (
    <>
      {/* Обложка первой, под ней крошки, название и факты. */}
      <ShowCover show={show} />
      <ShowHero show={show} performances={performances} />

      <section id="about" className={`container ${styles.about}`} aria-label="О спектакле">
        <ShowAbout
          show={show}
          photos={personPhotos}
          buy={<ShowBuy performances={performances} />}
        />
      </section>

      <section id="tickets" className={`container ${styles.section}`} aria-label="Даты и билеты">
        <Suspense>
          <ShowBooking performances={performances} fallbackUrl={fallbackUrl} />
        </Suspense>
      </section>

      {show.gallery.length > 0 && (
        <section
          id="photos"
          className={`container ${styles.section}`}
          aria-labelledby="photos-title"
        >
          <h2 id="photos-title" className={styles.title}>
            Фото
          </h2>
          <div className={styles.gallery}>
            <Gallery
              label={`Фото спектакля «${show.title}»`}
              items={showGalleryItems(show.gallery, show.title)}
            />
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section className={`container ${styles.section}`} aria-labelledby="others-title">
          <div className={styles.head}>
            <h2 id="others-title" className={styles.title}>
              Другие спектакли
            </h2>
            <Link href="/afisha" className={styles.all}>
              Вся афиша
            </Link>
          </div>
          <ul className={styles.cards}>
            {others.map((item) => {
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
      )}
    </>
  )
}
