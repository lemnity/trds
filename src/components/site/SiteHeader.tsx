import Link from 'next/link'

import buttons from '../ui/button.module.css'
import styles from './SiteHeader.module.css'

// Пункты «О театре», «Корпоративы», поиск появятся вместе со своими страницами (T-022, T-034):
// ссылки в никуда не показываем.
export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        {/* Текстовый знак до получения векторного логотипа от театра (T-004). */}
        <Link href="/" className={styles.brand} aria-label="TURDUS — модный театр, на главную">
          <span className={styles.wordmark}>TURDUS</span>
          <span className={styles.tagline}>модный театр</span>
        </Link>
        <nav aria-label="Основная навигация" className={styles.navWrap}>
          <ul className={styles.nav}>
            <li>
              <Link href="/afisha">Афиша</Link>
            </li>
            <li>
              <a href="#contacts">Контакты</a>
            </li>
          </ul>
        </nav>
        <Link href="/afisha" className={`${buttons.button} ${styles.cta}`}>
          Купить билет
        </Link>
      </div>
    </header>
  )
}
