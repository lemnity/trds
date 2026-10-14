import type { Metadata } from 'next'
import { Suspense } from 'react'

import { AfishaBoard } from '@/components/afisha/AfishaBoard'
import { Board } from '@/components/board/Board'
import { getShowsData, listUpcoming } from '@/modules/shows'

import styles from '../page-head.module.css'

export const metadata: Metadata = {
  title: 'Афиша',
  description: 'Ближайшие спектакли модного театра TURDUS: даты, площадки и билеты.',
}

export default function AfishaPage() {
  const upcoming = listUpcoming(getShowsData(), new Date())
  return (
    <div className="container">
      <header className={styles.head}>
        <h1 className={styles.title}>Афиша</h1>
        <p className={styles.lead}>Даты, площадки и билеты. Время — екатеринбургское.</p>
      </header>
      {/* Фильтр читает ?kind= из адреса; без JS показывается полный список. */}
      <Suspense fallback={<Board items={upcoming} label="Все ближайшие показы" />}>
        <AfishaBoard items={upcoming} />
      </Suspense>
    </div>
  )
}
