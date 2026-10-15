'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import { MAIN_NAV, type NavLink } from './navigation'
import styles from './MainNav.module.css'

type ItemLinkProps = NavLink & { className?: string; onClick?: () => void }

const ItemLink = ({ href, label, className, onClick }: ItemLinkProps) =>
  href.startsWith('#') ? (
    <a href={href} className={className} onClick={onClick}>
      {label}
    </a>
  ) : (
    <Link href={href} className={className} onClick={onClick}>
      {label}
    </Link>
  )

/**
 * Главное меню с выпадающими подменю — паттерн «навигация с раскрытием» (не ARIA menu):
 * раздел остаётся ссылкой, рядом кнопка-стрелка с aria-expanded. Подменю открывается
 * наведением (с задержкой закрытия), кнопкой, с клавиатуры; закрывается Esc и кликом мимо.
 */
export function MainNav() {
  const ids = useId()
  const navRef = useRef<HTMLElement>(null)
  const closeTimer = useRef<number>(undefined)
  const [open, setOpen] = useState<number | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)

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
            className={styles.item}
            onMouseEnter={item.children ? () => hoverOpen(i) : undefined}
            onMouseLeave={item.children ? hoverClose : undefined}
            onKeyDown={(event) => onKeyDown(event, i)}
          >
            <ItemLink href={item.href} label={item.label} className={styles.link} />
            {item.children && (
              <>
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
                <ul id={`${ids}-sub-${i}`} className={styles.sub} hidden={open !== i}>
                  {item.children.map((child) => (
                    <li key={child.href + child.label}>
                      <ItemLink
                        href={child.href}
                        label={child.label}
                        className={styles.subLink}
                        onClick={() => setOpen(null)}
                      />
                    </li>
                  ))}
                </ul>
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
        Меню
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
        </ul>
      </div>
    </nav>
  )
}
