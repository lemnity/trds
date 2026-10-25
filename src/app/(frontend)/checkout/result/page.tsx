import type { Metadata } from 'next'
import { Suspense } from 'react'

import { CheckoutResult } from '@/components/checkout/CheckoutResult'
import { cardClass } from '@/components/ui/card'

import styles from '../[performanceId]/checkout.module.css'

export const metadata: Metadata = {
  title: 'Оплата заказа',
  robots: { index: false, follow: false },
}

/** Возврат из банка: статус заказа — с сервера (CheckoutResult), не из адреса. */
export default function CheckoutResultPage() {
  return (
    <div className={`container ${styles.page}`}>
      <section className={cardClass(styles.panel)} aria-labelledby="result-title">
        <p className={styles.eyebrow}>Билетная касса</p>
        <h1 id="result-title" className={styles.title}>
          Оплата заказа
        </h1>
        <div className={styles.result}>
          <Suspense>
            <CheckoutResult />
          </Suspense>
        </div>
      </section>
    </div>
  )
}
