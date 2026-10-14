import Image from 'next/image'

import logo from '@/assets/logo.webp'

import styles from './SiteFooter.module.css'

// Контакты с главной страницы teatrturdus.ru (14.10.2026). На внутренних страницах старого сайта
// указаны другие телефоны — актуальный набор подтверждает театр (memory.md).
export function SiteFooter() {
  return (
    <footer id="contacts" tabIndex={-1} className={styles.footer}>
      <div className={`container ${styles.grid}`}>
        <div>
          <Image src={logo} alt="TURDUS — модный театр" className={styles.logo} />
          <p className={styles.slogan}>Повод выйти в свет!</p>
          <p className={styles.muted}>Екатеринбург</p>
        </div>
        <address className={styles.contacts}>
          <h2 className={styles.label}>Контакты</h2>
          <a href="tel:+79826575426">+7 982 657-54-26</a>
          <a href="mailto:rechevik@inbox.ru">rechevik@inbox.ru</a>
          <span>ул. Малышева, 19, деловой центр, 3 этаж, офис 1308</span>
          <span className={styles.muted}>Без выходных с 10:00 до 22:00</span>
        </address>
      </div>
    </footer>
  )
}
