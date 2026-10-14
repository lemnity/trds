import type { ReactNode } from 'react'

import styles from './InlineNotice.module.css'

type Tone = 'warning' | 'danger' | 'info'

export function InlineNotice({
  tone,
  title,
  children,
}: {
  tone: Tone
  title: string
  children?: ReactNode
}) {
  return (
    <div
      className={`${styles.notice} ${styles[tone]}`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <p className={styles.title}>{title}</p>
      {children && <div className={styles.body}>{children}</div>}
    </div>
  )
}
