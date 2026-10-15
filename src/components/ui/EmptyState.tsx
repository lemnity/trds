import type { ReactNode } from 'react'

import styles from './EmptyState.module.css'
import { cardClass } from './card'

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={cardClass(styles.empty)} role="status">
      <p className={styles.title}>{title}</p>
      {children && <div className={styles.body}>{children}</div>}
    </div>
  )
}
