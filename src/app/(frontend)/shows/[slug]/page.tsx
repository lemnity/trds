import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { HideWhenStarted } from '@/components/board/HideWhenStarted'
import { ShowCard } from '@/components/board/ShowCard'
import { ShowBooking } from '@/components/show/ShowBooking'
import { Gallery } from '@/components/show/Gallery'
import { ShowAbout } from '@/components/show/ShowAbout'
import { ShowBuy, ShowCover, ShowTitle } from '@/components/show/ShowHeaderCompact'
import { getShowPage, getShowsData, listPublishedShows, listUpcoming } from '@/modules/shows'

import styles from './show.module.css'

type Params = { slug: string }

export const dynamicParams = false

export function generateStaticParams(): Params[] {
  return listPublishedShows(getShowsData()).map((s) => ({ slug: s.slug }))
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params
  const page = getShowPage(getShowsData(), slug, new Date())
  if (!page) return {}
  return { title: page.show.title, description: page.show.lead }
}

const OTHER_SHOWS = 4

export default async function ShowPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const data = getShowsData()
  const now = new Date()
  const page = getShowPage(data, slug, now)
  if (!page) notFound()
  const { show, performances } = page

  const posters = new Map(data.shows.map((s) => [s.slug, s.posterUrl]))
  const seen = new Set([slug])
  const others = listUpcoming(data, now)
    .filter((p) => !seen.has(p.show.slug) && seen.add(p.show.slug))
    .slice(0, OTHER_SHOWS)
  // Старый сайт театра: на нём продажи через Ticketscloud, пока не подключён банк.
  const fallbackUrl = `https://teatrturdus.ru/${show.slug}`

  return (
    <>
      <ShowCover show={show} />

      <section id="about" className={`container ${styles.about}`} aria-label="О спектакле">
        <ShowAbout
          show={show}
          intro={<ShowTitle show={show} performances={performances} />}
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
            <Gallery photos={show.gallery} title={show.title} />
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
