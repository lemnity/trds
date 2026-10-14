import { Chip } from '@heroui/react'

import styles from './PremiereBadge.module.css'

/** Бейдж «Премьера» — по пометке театра (поле premiere спектакля). */
export function PremiereBadge({ overlay = false }: { overlay?: boolean }) {
  return (
    <Chip
      size="sm"
      color="accent"
      variant="primary"
      className={`${styles.badge} ${overlay ? styles.overlay : ''}`}
    >
      Премьера
    </Chip>
  )
}
