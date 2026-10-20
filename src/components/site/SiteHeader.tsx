import Image from 'next/image'
import Link from 'next/link'

import logo from '@/assets/logo.webp'
import { formatPerformanceDate, getShowsData, groupByMonth, listUpcoming } from '@/modules/shows'

import styles from './SiteHeader.module.css'
import { ButtonLink } from '../ui/ButtonLink'
import { TicketIcon } from '../ui/TicketIcon'
import { HeaderScrollState } from './HeaderScrollState'
import { HeaderSearch } from './HeaderSearch'
import { LogoBird } from './LogoBird'
import { MainNav, type MegaShow } from './MainNav'
import { LowVisionToggle } from './LowVisionToggle'
import { AccountMenu } from './AccountMenu'
import { SCHOOL_LINK } from './navigation'

// «Корпоративы» и поиск появятся вместе со своими страницами (T-034): ссылки в никуда не показываем.
// «Личный кабинет» — кнопка с подменю (AccountMenu): гостю вход/регистрация, вошедшему — кабинет.
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
    .map((s) => ({ href: `/shows/${s.slug}`, label: s.title, meta: s.genre ?? undefined }))
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
      <HeaderScrollState />
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
          <a
            href={SCHOOL_LINK.href}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.school}
          >
            <span className={styles.schoolDot} aria-hidden="true" />
            <span className={styles.schoolFull}>{SCHOOL_LINK.label}</span>
            <span className={styles.schoolShort} aria-hidden="true">
              Школа
            </span>
            <span className="visually-hidden"> (откроется в новой вкладке)</span>
          </a>
          <AccountMenu />
          <ButtonLink href="/afisha" className={styles.cta}>
            <TicketIcon />
            <span className={styles.ctaLabel}>Купить билет</span>
          </ButtonLink>
        </div>
      </div>
    </header>
  )
}
