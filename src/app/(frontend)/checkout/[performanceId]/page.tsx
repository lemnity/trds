import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { CheckoutView } from '@/components/checkout/CheckoutView'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { cardClass } from '@/components/ui/card'
import { findPerformance, formatPerformanceDate, getShowsData } from '@/modules/shows'

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

const CloseIcon = () => (
  <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
    <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

/** Оформление по референсу заказчика: панель «Шаг 2 из 2», форма слева, «Ваши места» справа. */
export default async function CheckoutPage({ params }: { params: Promise<Params> }) {
  const { performanceId } = await params
  const performance = findPerformance(getShowsData(), performanceId, new Date())
  if (!performance) notFound()
  const backHref = `/shows/${performance.show.slug}?date=${performance.id}#tickets`
  const date = formatPerformanceDate(performance.startsAt)

  return (
    <div className={`container ${styles.page}`}>
      <section className={cardClass(styles.panel)} aria-labelledby="checkout-title">
        <ButtonLink
          href={backHref}
          variant="outline"
          isIconOnly
          className={styles.close}
          aria-label="Закрыть и вернуться к выбору мест"
        >
          <CloseIcon />
        </ButtonLink>
        <p className={styles.eyebrow}>Шаг 2 из 2 · Оформление</p>
        <h1 id="checkout-title" className={styles.title}>
          Почти на сцене
        </h1>
        <p className={styles.show}>
          {performance.show.title} · {date.longDate}, {date.weekday}, {date.time} ·{' '}
          {performance.venue.title}
        </p>
        <Suspense>
          <CheckoutView
            performance={performance}
            backHref={backHref}
            fallbackUrl={`https://teatrturdus.ru/${performance.show.slug}`}
          />
        </Suspense>
      </section>
    </div>
  )
}
