'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'

import { CookieSettingsButton } from './CookieConsent'
import styles from './SiteFooter.module.css'

export type FooterDoc = { href: string; title: string }

const COOKIE_SETTINGS = 'Настройки cookie'

/**
 * Документы в подвале одной строкой: ссылки идут по важности, что не помещается — уходит в меню «⋯».
 * Ширины берутся из скрытого ряда-мерки; до замера (и без JS) ссылки просто переносятся.
 * Меню закрывается Esc, кликом мимо и выбором пункта.
 */
export function FooterDocs({ docs }: { docs: FooterDoc[] }) {
  const id = useId()
  const navRef = useRef<HTMLElement>(null)
  const measureRef = useRef<HTMLUListElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const total = docs.length + 1 // + «Настройки cookie»
  const [visible, setVisible] = useState<number | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const nav = navRef.current
    const measure = measureRef.current
    if (!nav || !measure) return
    const fit = () => {
      const gap = parseFloat(getComputedStyle(measure).columnGap) || 0
      const widths = [...measure.children].map((el) => el.getBoundingClientRect().width)
      const more = widths.pop() ?? 0 // последний в мерке — кнопка «⋯»
      const avail = nav.clientWidth
      const all = widths.reduce((sum, w, i) => sum + w + (i ? gap : 0), 0)
      if (all <= avail) return setVisible(widths.length)
      let used = more
      let n = 0
      for (const w of widths) {
        if (used + gap + w > avail) break
        used += gap + w
        n++
      }
      setVisible(n)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(nav)
    // Шрифт догружается позже первого замера — пересчитать.
    document.fonts?.ready.then(fit)
    return () => observer.disconnect()
  }, [docs])

  const count = visible ?? total
  const hasMore = count < total

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Меню больше не нужно (всё поместилось) — закрыть.
  if (open && !hasMore) setOpen(false)

  const item = (i: number, className?: string) => {
    const doc = docs[i]
    return doc ? (
      <Link href={doc.href} className={className}>
        {doc.title}
      </Link>
    ) : (
      // Отозвать или дать согласие на аналитику в любой момент (T-036).
      <CookieSettingsButton className={className ?? styles.docButton} />
    )
  }

  const indexes = Array.from({ length: total }, (_, i) => i)

  return (
    <nav ref={navRef} aria-label="Документы" className={styles.docsNav}>
      <ul className={styles.docs} data-fit={visible !== null || undefined}>
        {indexes.slice(0, count).map((i) => (
          <li key={i}>{item(i)}</li>
        ))}
      </ul>

      {hasMore && (
        <div ref={moreRef} className={styles.more}>
          <button
            ref={buttonRef}
            type="button"
            className={styles.moreButton}
            aria-expanded={open}
            aria-controls={`${id}-menu`}
            aria-label="Ещё документы"
            onClick={() => setOpen(!open)}
          >
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
              <circle cx="4" cy="10" r="1.6" fill="currentColor" />
              <circle cx="10" cy="10" r="1.6" fill="currentColor" />
              <circle cx="16" cy="10" r="1.6" fill="currentColor" />
            </svg>
          </button>
          {/* Клик по пункту (ссылка или «Настройки cookie») всплывает сюда и закрывает меню. */}
          <ul
            id={`${id}-menu`}
            className={styles.moreMenu}
            hidden={!open}
            onClick={() => setOpen(false)}
          >
            {indexes.slice(count).map((i) => (
              <li key={i}>{item(i, styles.moreLink)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Мерка: те же подписи в один ряд, невидимая и недоступная. */}
      <ul ref={measureRef} className={styles.measure} aria-hidden="true" inert>
        {docs.map((d) => (
          <li key={d.href}>{d.title}</li>
        ))}
        <li>{COOKIE_SETTINGS}</li>
        <li className={styles.moreButton} />
      </ul>
    </nav>
  )
}
