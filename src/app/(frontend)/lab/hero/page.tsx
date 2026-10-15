import type { Metadata } from 'next'
import { Suspense } from 'react'

import { HeroLab, type LabSlide } from '@/components/lab/HeroLab'
import { formatAge, formatPerformanceDate, getShowsData, heroSlides } from '@/modules/shows'

export const metadata: Metadata = {
  title: 'Превью главного слайдера',
  robots: { index: false, follow: false },
}

/** Живое превью вариантов главного слайдера (выбор заказчика). Не в меню и не в индексе. */
export default function HeroLabPage() {
  const data = getShowsData()
  const shows = new Map(data.shows.map((s) => [s.slug, s]))
  const slides: LabSlide[] = heroSlides(data, new Date(), 8).map((p) => {
    const show = shows.get(p.show.slug)!
    const d = formatPerformanceDate(p.startsAt)
    return {
      id: p.id,
      href: `/shows/${p.show.slug}?date=${p.id}#tickets`,
      title: p.show.title,
      day: d.day,
      month: d.month,
      longDate: d.longDate,
      weekday: d.weekday,
      time: d.time,
      venue: p.venue.title,
      meta: [p.show.genre, formatAge(p.show.ageLimit)].filter(Boolean).join(' · '),
      photo: show.gallery[0] ?? show.posterUrl,
      salesOpen: p.salesOpen,
    }
  })
  return (
    <div className="container">
      <Suspense>
        <HeroLab slides={slides} />
      </Suspense>
    </div>
  )
}
