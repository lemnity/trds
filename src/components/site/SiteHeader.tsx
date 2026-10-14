import Image from 'next/image'
import Link from 'next/link'

import logo from '@/assets/logo.webp'

import buttons from '../ui/button.module.css'
import styles from './SiteHeader.module.css'

// «Корпоративы» и поиск появятся вместе со своими страницами (T-034): ссылки в никуда не показываем.
// «Личный кабинет» ведёт на /account: до T-050/T-051 там честное объяснение, без формы входа.
export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <Link href="/" className={styles.brand}>
          <Image
            src={logo}
            alt="TURDUS — модный театр, на главную"
            priority
            className={styles.logo}
          />
        </Link>
        <nav aria-label="Основная навигация" className={styles.navWrap}>
          <ul className={styles.nav}>
            <li>
              <Link href="/afisha">Афиша</Link>
            </li>
            <li>
              <Link href="/about">О театре</Link>
            </li>
            <li>
              <a href="#contacts">Контакты</a>
            </li>
          </ul>
        </nav>
        <div className={styles.actions}>
          <Link href="/account" className={styles.account}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <circle cx="10" cy="7" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M3.8 17c.9-3.1 3.3-4.7 6.2-4.7s5.3 1.6 6.2 4.7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            <span className={styles.accountLabel}>Личный кабинет</span>
          </Link>
          <Link href="/afisha" className={`${buttons.button} ${styles.cta}`}>
            Купить билет
          </Link>
        </div>
      </div>
    </header>
  )
}
