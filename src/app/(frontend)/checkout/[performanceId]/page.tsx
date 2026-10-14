import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { CheckoutView } from '@/components/checkout/CheckoutView'
import { VenueTag } from '@/components/ui/VenueTag'
import { findPerformance, formatPerformanceDate, getShowsData } from '@/modules/shows'

import head from '../../page-head.module.css'
import styles from './checkout.module.css'

type Params = { performanceId: string }

export const dynamicParams = false

export const metadata: Metadata = {
  title: 'Оформление заказа',
  robots: { index: false, follow: false },
}

// Все показы с ценами (не только будущие): пустой список ломает static export, прошедший
// на момент сборки показ отдаёт 404. После сборки начало показа проверяет CheckoutView.
export function generateStaticParams(): Params[] {
  return getShowsData()
    .performances.filter(
      (p) => p.ticketTypes.length > 0 || Object.keys(p.seating?.pricesKopecks ?? {}).length > 0,
    )
    .map((p) => ({ performanceId: p.id }))
}

export default async function CheckoutPage({ params }: { params: Promise<Params> }) {
  const { performanceId } = await params
  const performance = findPerformance(getShowsData(), performanceId, new Date())
  if (!performance) notFound()
  const date = formatPerformanceDate(performance.startsAt)

  return (
    <div className="container">
      <header className={head.head}>
        <h1 className={head.title}>Оформление заказа</h1>
      </header>
      <div className={styles.layout}>
        <aside className={styles.ticket} aria-label="Показ">
          <p className={styles.show}>{performance.show.title}</p>
          <p className={styles.when}>
            {date.longDate}, {date.weekday} · {date.time}
          </p>
          <p className={styles.where}>
            <VenueTag kind={performance.venue.kind} /> {performance.venue.title}
          </p>
          <p className={styles.address}>{performance.venue.address}</p>
        </aside>
        <Suspense>
          <CheckoutView
            performance={performance}
            fallbackUrl={`https://teatrturdus.ru/${performance.show.slug}`}
          />
        </Suspense>
      </div>
    </div>
  )
}
