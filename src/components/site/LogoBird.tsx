import Image from 'next/image'

import bird from '@/assets/logo-bird.png'

import styles from './LogoBird.module.css'

/**
 * Птица из логотипа театра (дрозд — turdus): вырезана из логотипа заказчика (657657.png,
 * прозрачный фон). Периодически прыгает (LogoBird.module.css); при prefers-reduced-motion
 * и в версии для слабовидящих сидит. Место и размер задаёт родитель (шапка, подвал).
 */
export function LogoBird({ className }: { className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      <span className={styles.hopper}>
        <Image src={bird} alt="" sizes="96px" />
      </span>
    </span>
  )
}
