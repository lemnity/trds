import Image from 'next/image'
import Link from 'next/link'

import logo from '@/assets/logo.webp'
import { formatPerformanceDate, getShowsData, groupByMonth, listUpcoming } from '@/modules/shows'

import styles from './SiteHeader.module.css'
import { ButtonLink } from '../ui/ButtonLink'
import { TicketIcon } from '../ui/TicketIcon'
import { HeaderSearch } from './HeaderSearch'
import { LogoBird } from './LogoBird'
import { MainNav, type MegaShow } from './MainNav'
import { LowVisionToggle } from './LowVisionToggle'

// «Корпоративы» и поиск появятся вместе со своими страницами (T-034): ссылки в никуда не показываем.
// «Личный кабинет» ведёт на /account: до T-050/T-051 там честное объяснение, без формы входа.
/** Сколько ближайших показов отдать меню: начавшиеся отсеиваются в браузере. */
const MEGA_UPCOMING = 8

export function SiteHeader() {
  const data = getShowsData()
  const upcoming = listUpcoming(data, new Date())
  const posters = new Map(data.shows.map((s) => [s.slug, s.posterUrl]))
  const months = groupByMonth(upcoming).map((g) => ({
    href: `/afisha?month=${g.key}`,
    label: g.label,
  }))
  // «Наши спектакли» в мега-меню — весь репертуар по алфавиту.
  const shows = [...data.shows]
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
    .map((s) => ({ href: `/shows/${s.slug}`, label: s.title }))
  const nearest: MegaShow[] = upcoming.slice(0, MEGA_UPCOMING).map((p) => {
    const date = formatPerformanceDate(p.startsAt)
    return {
      id: p.id,
      href: `/shows/${p.show.slug}?date=${p.id}#tickets`,
      title: p.show.title,
      startsAt: p.startsAt,
      when: `${date.longDate}, ${date.weekday} · ${date.time}`,
      venue: p.venue.title,
      posterUrl: posters.get(p.show.slug) ?? null,
      salesOpen: p.salesOpen,
    }
  })

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
          <LogoBird className={styles.bird} />
        </Link>
        <MainNav shows={shows} months={months} nearest={nearest} />
        <div className={styles.actions}>
          <HeaderSearch />
          <LowVisionToggle />
          <ButtonLink href="/account" variant="outline" className={styles.account}>
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
          </ButtonLink>
          <ButtonLink href="/afisha" className={styles.cta}>
            <TicketIcon />
            Купить билет
          </ButtonLink>
        </div>
      </div>
    </header>
  )
}
