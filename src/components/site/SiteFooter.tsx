import Image from 'next/image'
import Link from 'next/link'

import logo from '@/assets/logo.webp'
import { legalDocuments } from '@/modules/content'

import styles from './SiteFooter.module.css'

const NAV = [
  { href: '/afisha', title: 'Афиша' },
  { href: '/about', title: 'О театре' },
  { href: '/account', title: 'Личный кабинет' },
]

/** «oo» в Simakoov — знак бесконечности, по которому бежит штрих (без анимации при reduced motion). */
function DevCredit() {
  return (
    <p className={styles.credit}>
      Разработка{' '}
      <strong className={styles.creditName}>
        <span className="visually-hidden">Simakoov</span>
        <span aria-hidden="true" className={styles.creditWord}>
          Simak
          <svg viewBox="0 0 24 12" className={styles.infinity}>
            <path
              className={styles.infinityBase}
              d="M12 6C10 3.3 8 2 6 2a4 4 0 0 0 0 8c2 0 4-1.3 6-4s4-4 6-4a4 4 0 0 1 0 8c-2 0-4-1.3-6-4z"
              pathLength={100}
            />
            <path
              className={styles.infinityTrace}
              d="M12 6C10 3.3 8 2 6 2a4 4 0 0 0 0 8c2 0 4-1.3 6-4s4-4 6-4a4 4 0 0 1 0 8c-2 0-4-1.3-6-4z"
              pathLength={100}
            />
          </svg>
          v
        </span>
      </strong>
    </p>
  )
}

// Контакты с главной страницы teatrturdus.ru (14.10.2026). На внутренних страницах старого сайта
// указаны другие телефоны — актуальный набор подтверждает театр (memory.md).
export function SiteFooter() {
  return (
    <footer id="contacts" tabIndex={-1} className={styles.footer}>
      <div className={`container ${styles.top}`}>
        <div className={styles.brand}>
          <Image src={logo} alt="TURDUS — модный театр" className={styles.logo} />
          <p className={styles.slogan}>Повод выйти в свет!</p>
          <p className={styles.muted}>Иммерсивные спектакли в Екатеринбурге</p>
        </div>
        <nav aria-labelledby="footer-nav" className={styles.column}>
          <h2 id="footer-nav" className={styles.label}>
            Театр
          </h2>
          <ul>
            {NAV.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.title}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <address className={styles.column}>
          <h2 className={styles.label}>Контакты</h2>
          <a href="tel:+79826575426" className={styles.big}>
            +7 982 657-54-26
          </a>
          <a href="mailto:rechevik@inbox.ru" className={styles.big}>
            rechevik@inbox.ru
          </a>
          <span>ул. Малышева, 19, деловой центр, 3 этаж, офис 1308</span>
          <span className={styles.muted}>Без выходных с 10:00 до 22:00</span>
        </address>
      </div>

      <div className={`container ${styles.bottom}`}>
        <nav aria-label="Документы">
          <ul className={styles.docs}>
            {legalDocuments.map((doc) => (
              <li key={doc.slug}>
                <Link href={`/documents/${doc.slug}`}>{doc.title}</Link>
              </li>
            ))}
            <li>
              <Link href="/site-map">Карта сайта</Link>
            </li>
          </ul>
        </nav>
        <DevCredit />
      </div>
    </footer>
  )
}
