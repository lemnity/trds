import { Skeleton } from '@heroui/react'

import styles from './loading.module.css'

export default function Loading() {
  return (
    <div className="container" role="status" aria-live="polite">
      <span className="visually-hidden">Загружаем афишу…</span>
      <Skeleton className={styles.title} />
      <div className={styles.board}>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className={styles.row} />
        ))}
      </div>
    </div>
  )
}
