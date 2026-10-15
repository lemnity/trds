import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { CheckoutView } from '@/components/checkout/CheckoutView'
import { findPerformance, getShowsData } from '@/modules/shows'

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
  const backHref = `/shows/${performance.show.slug}?date=${performance.id}#tickets`

  return (
    <div className="container">
      <header className={styles.head}>
        <Link href={backHref} className={styles.back}>
          ← Изменить выбор
        </Link>
        <h1 className={styles.title}>Оформление заказа</h1>
        <ol className={styles.steps} aria-label="Шаги покупки">
          <li data-state="done">
            <span className={styles.stepMark} aria-hidden="true">
              ✓
            </span>
            Билеты<span className="visually-hidden"> — готово</span>
          </li>
          <li data-state="current" aria-current="step">
            <span className={styles.stepMark} aria-hidden="true">
              2
            </span>
            Контакты
          </li>
          <li>
            <span className={styles.stepMark} aria-hidden="true">
              3
            </span>
            Оплата
          </li>
        </ol>
      </header>
      <Suspense>
        <CheckoutView
          performance={performance}
          backHref={backHref}
          fallbackUrl={`https://teatrturdus.ru/${performance.show.slug}`}
        />
      </Suspense>
    </div>
  )
}
