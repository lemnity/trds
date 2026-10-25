import Image from 'next/image'
import Link from 'next/link'

import logo from '@/assets/logo.webp'
import { contacts, legalDocuments } from '@/modules/content'

import { CookieSettingsButton } from './CookieConsent'
import { LogoBird } from './LogoBird'
import { SocialIcon } from './SocialIcon'
import { ACCOUNT_HREF } from './navigation'
import styles from './SiteFooter.module.css'

const NAV = [
  { href: '/afisha', title: 'Афиша' },
  { href: '/about', title: 'О театре' },
  { href: '/corporate', title: 'Корпоративы' },
  { href: '/school', title: 'Актёрская школа' },
  { href: '/contacts', title: 'Контакты' },
  { href: ACCOUNT_HREF, title: 'Личный кабинет' },
]

/** Ссылка на сайт разработчика (simakoov.ru). «oo» в Simakoov — знак бесконечности, по которому бежит штрих (без анимации при reduced motion). */
function DevCredit() {
  return (
    <p className={styles.credit}>
      Разработка{' '}
      <a href="https://simakoov.ru/" target="_blank" rel="noopener" className={styles.creditName}>
        <span className="visually-hidden">Simakoov (откроется в новой вкладке)</span>
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
      </a>
    </p>
  )
}

// Контакты — из modules/content (общие с /contacts).
export function SiteFooter() {
  return (
    <footer id="contacts" tabIndex={-1} className={styles.footer}>
      <div className={`container ${styles.top}`}>
        <div className={styles.brand}>
          <LogoBird className={styles.bird} />
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
          <a href={contacts.phone.href} className={styles.big}>
            {contacts.phone.display}
          </a>
          <a href={`mailto:${contacts.email}`} className={styles.big}>
            {contacts.email}
          </a>
          <span>{contacts.office.short}</span>
          <span className={styles.muted}>{contacts.office.hours}</span>
          <ul className={styles.social} aria-label="Театр в соцсетях">
            {contacts.social.map((s) => (
              <li key={s.name}>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.socialLink}
                  aria-label={`${s.name} — ${s.handle} (откроется в новой вкладке)`}
                >
                  <SocialIcon name={s.name} />
                  <span>{s.name}</span>
                </a>
              </li>
            ))}
          </ul>
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
            <li>
              {/* Отозвать или дать согласие на аналитику в любой момент (T-036). */}
              <CookieSettingsButton className={styles.docButton} />
            </li>
          </ul>
        </nav>
        <DevCredit />
      </div>
    </footer>
  )
}
