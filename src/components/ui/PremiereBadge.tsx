import styles from './PremiereBadge.module.css'

/** Бейдж «Премьера» — по пометке театра (поле premiere спектакля). */
export function PremiereBadge({ overlay = false }: { overlay?: boolean }) {
  return <span className={`${styles.badge} ${overlay ? styles.overlay : ''}`}>Премьера</span>
}
