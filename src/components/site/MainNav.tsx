'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'

import { ButtonLink } from '../ui/ButtonLink'
import { TicketIcon } from '../ui/TicketIcon'
import { ACCOUNT_HREF, AFISHA_GROUPS, MAIN_NAV, type NavLink } from './navigation'
import { NavIcon } from './NavIcon'
import styles from './MainNav.module.css'

/** Показ для карточки «Ближайший спектакль» в мега-меню (подготовлен на сервере). */
export type MegaShow = {
  id: string
  href: string
  title: string
  startsAt: string
  when: string
  venue: string
  posterUrl: string | null
  salesOpen: boolean
}

/** Спектакль в мега-меню: название и жанр подписью. */
export type ShowLink = NavLink & { meta?: string }

type Props = { shows: ShowLink[]; months: NavLink[]; nearest: MegaShow[] }

const noopSubscribe = () => () => {}

type ItemLinkProps = NavLink & { className?: string; onClick?: () => void }

const ItemLink = ({ href, label, icon, className, onClick }: ItemLinkProps) => {
  const content = (
    <>
      {icon && <NavIcon name={icon} />}
      {label}
    </>
  )
  return href.startsWith('#') ? (
    <a href={href} className={className} onClick={onClick}>
      {content}
    </a>
  ) : (
    <Link href={href} className={className} onClick={onClick}>
      {content}
    </Link>
  )
}

/**
 * Главное меню с выпадающими подменю — паттерн «навигация с раскрытием» (не ARIA menu):
 * раздел остаётся ссылкой, рядом кнопка-стрелка с aria-expanded. Подменю открывается
 * наведением (с задержкой закрытия), кнопкой, с клавиатуры; закрывается Esc и кликом мимо.
 */
export function MainNav({ shows, months, nearest }: Props) {
  const ids = useId()
  const navRef = useRef<HTMLElement>(null)
  const closeTimer = useRef<number>(undefined)
  const [open, setOpen] = useState<number | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  // Статическая сборка фиксирует список на момент build — начавшиеся показы отсеиваем
  // в браузере (на сервере берём первый из списка).
  const nearestId = useSyncExternalStore(
    noopSubscribe,
    () => nearest.find((p) => Date.parse(p.startsAt) > Date.now())?.id ?? null,
    () => nearest[0]?.id ?? null,
  )
  const featured = nearest.find((p) => p.id === nearestId) ?? null
  const megaGroups = months.length
    ? [...AFISHA_GROUPS, { title: 'По месяцам', links: months }]
    : AFISHA_GROUPS
  const chevron = (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" className={styles.chevron}>
      <path
        d="M5 7.5 10 12.5 15 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
  const close = () => setOpen(null)

  useEffect(() => {
    if (open === null && !mobileOpen) return
    const onPointer = (event: PointerEvent) => {
      if (navRef.current?.contains(event.target as Node)) return
      setOpen(null)
      setMobileOpen(false)
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, mobileOpen])

  const hoverOpen = (i: number) => {
    window.clearTimeout(closeTimer.current)
    setOpen(i)
  }
  const hoverClose = () => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setOpen(null), 180)
  }

  const onKeyDown = (event: KeyboardEvent, i: number) => {
    if (event.key !== 'Escape' || open !== i) return
    setOpen(null)
    navRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${ids}-btn-${i}`)}`)?.focus()
  }

  return (
    <nav ref={navRef} aria-label="Основная навигация" className={styles.nav}>
      <ul className={styles.list}>
        {MAIN_NAV.map((item, i) => (
          <li
            key={item.href}
            className={item.mega ? `${styles.item} ${styles.itemMega}` : styles.item}
            onMouseEnter={item.children ? () => hoverOpen(i) : undefined}
            onMouseLeave={item.children ? hoverClose : undefined}
            onKeyDown={(event) => onKeyDown(event, i)}
          >
            {item.mega ? (
              // Мега-меню: раздел — кнопка, открывает панель (страница афиши — ссылкой внутри).
              <button
                id={`${ids}-btn-${i}`}
                type="button"
                className={`${styles.link} ${styles.trigger}`}
                aria-expanded={open === i}
                aria-controls={`${ids}-sub-${i}`}
                onClick={() => setOpen(open === i ? null : i)}
              >
                {item.label}
                {chevron}
              </button>
            ) : (
              <ItemLink href={item.href} label={item.label} className={styles.link} />
            )}
            {item.children && (
              <>
                {!item.mega && (
                  <button
                    id={`${ids}-btn-${i}`}
                    type="button"
                    className={styles.toggle}
                    aria-expanded={open === i}
                    aria-controls={`${ids}-sub-${i}`}
                    aria-label={`Подразделы: ${item.label}`}
                    onClick={() => setOpen(open === i ? null : i)}
                  >
                    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                      <path
                        d="M5 7.5 10 12.5 15 7.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
                {item.mega ? (
                  <div
                    id={`${ids}-sub-${i}`}
                    className={styles.mega}
                    data-open={open === i || undefined}
                    inert={open !== i || undefined}
                  >
                    <div className={`container ${styles.megaInner}`}>
                      {/* Зона 1: репертуар — строки с жанром, как каталог. */}
                      <section className={styles.zone} aria-labelledby={`${ids}-shows`}>
                        <p className={styles.megaTitle} id={`${ids}-shows`}>
                          Наши спектакли <span className={styles.count}>{shows.length}</span>
                        </p>
                        <ul className={styles.showList}>
                          {shows.map((show) => (
                            <li key={show.href}>
                              <Link href={show.href} className={styles.showLink} onClick={close}>
                                <span className={styles.showName}>{show.label}</span>
                                {show.meta && <span className={styles.showMeta}>{show.meta}</span>}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </section>

                      {/* Зона 2: подобрать по площадке и месяцу — плашки-фильтры. */}
                      <section className={styles.zone} aria-label="Подобрать спектакль">
                        {megaGroups.map((group) => (
                          <div key={group.title} className={styles.filterGroup}>
                            <p className={styles.megaTitle} id={`${ids}-g-${group.title}`}>
                              {group.title}
                            </p>
                            <ul
                              aria-labelledby={`${ids}-g-${group.title}`}
                              className={styles.pills}
                            >
                              {group.links.map((link) => (
                                <li key={link.href + link.label}>
                                  <ItemLink
                                    href={link.href}
                                    label={link.label}
                                    className={styles.pill}
                                    onClick={close}
                                  />
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </section>

                      {/* Зона 3: ближайший спектакль. */}
                      {featured && (
                        <article className={styles.feature} aria-labelledby={`${ids}-feature`}>
                          <p className={styles.megaTitle}>Ближайший спектакль</p>
                          {featured.posterUrl && (
                            <div className={styles.featureMedia}>
                              <Image src={featured.posterUrl} alt="" fill sizes="20rem" />
                            </div>
                          )}
                          <p className={styles.featureWhen}>{featured.when}</p>
                          <h2 id={`${ids}-feature`} className={styles.featureTitle}>
                            {featured.title}
                          </h2>
                          <p className={styles.featureVenue}>{featured.venue}</p>
                          <ButtonLink href={featured.href} fullWidth onClick={close}>
                            {featured.salesOpen ? (
                              <>
                                <TicketIcon /> Купить билет
                              </>
                            ) : (
                              'Подробнее о показе'
                            )}
                          </ButtonLink>
                        </article>
                      )}
                    </div>
                    <div className={styles.megaFooter}>
                      <div className={`container ${styles.megaFooterInner}`}>
                        <span className={styles.megaFooterNote}>
                          Даты, площадки и билеты на все показы
                        </span>
                        <ButtonLink href="/afisha" variant="outline" onClick={close}>
                          Вся афиша
                        </ButtonLink>
                      </div>
                    </div>
                  </div>
                ) : (
                  <ul id={`${ids}-sub-${i}`} className={styles.sub} hidden={open !== i}>
                    {item.children.map((child) => (
                      <li key={child.href + child.label}>
                        <ItemLink {...child} className={styles.subLink} onClick={close} />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      {/* Телефон и узкий планшет: разделы и подразделы — в панели по кнопке «Меню». */}
      <button
        type="button"
        className={styles.burger}
        aria-expanded={mobileOpen}
        aria-controls={`${ids}-mobile`}
        aria-label="Меню"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
          <path
            d={mobileOpen ? 'M5 5l10 10M15 5 5 15' : 'M3.5 6h13M3.5 10h13M3.5 14h13'}
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
        <span className={styles.burgerLabel}>Меню</span>
      </button>
      <div id={`${ids}-mobile`} className={styles.panel} hidden={!mobileOpen}>
        <ul className={styles.panelList}>
          {MAIN_NAV.map((item) => (
            <li key={item.href}>
              <ItemLink
                href={item.href}
                label={item.label}
                className={styles.panelLink}
                onClick={() => setMobileOpen(false)}
              />
              {item.children && (
                <ul className={styles.panelSub}>
                  {item.children
                    .filter((child) => child.href !== item.href)
                    .map((child) => (
                      <li key={child.href + child.label}>
                        <ItemLink
                          href={child.href}
                          label={child.label}
                          className={styles.panelSubLink}
                          onClick={() => setMobileOpen(false)}
                        />
                      </li>
                    ))}
                </ul>
              )}
            </li>
          ))}
          <li>
            <Link
              href={ACCOUNT_HREF}
              className={styles.panelLink}
              onClick={() => setMobileOpen(false)}
            >
              Личный кабинет
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  )
}
