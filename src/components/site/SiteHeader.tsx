import Image from 'next/image'
import Link from 'next/link'

import logo from '@/assets/logo.webp'

import buttons from '../ui/button.module.css'
import styles from './SiteHeader.module.css'

// Пункты «О театре», «Корпоративы», поиск появятся вместе со своими страницами (T-022, T-034):
// ссылки в никуда не показываем.
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
