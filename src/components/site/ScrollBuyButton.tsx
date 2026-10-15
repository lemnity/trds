'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { ButtonLink } from '../ui/ButtonLink'
import { TicketIcon } from '../ui/TicketIcon'
import styles from './ScrollBuyButton.module.css'

/** После какой прокрутки кнопка появляется (ниже первого экрана). */
const SHOW_AFTER_PX = 480

/** Где своя кнопка покупки уже есть — плавающая не нужна и перекрыла бы строку заказа. */
const HIDDEN_ON = [/^\/afisha/, /^\/shows\//, /^\/checkout\//]

/**
 * Плавающая кнопка «Купить билеты без комиссии» внизу экрана при прокрутке.
 * При наведении из иконки разлетаются билетики (без анимации при reduced motion).
 */
export function ScrollBuyButton() {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SHOW_AFTER_PX)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (HIDDEN_ON.some((re) => re.test(pathname))) return null
  const visible = scrolled

  return (
    <div className={styles.dock} data-visible={visible || undefined} inert={!visible || undefined}>
      <ButtonLink href="/afisha" className={styles.button}>
        <span className={styles.icon}>
          <span className={styles.flyer} aria-hidden="true">
            <TicketIcon size={14} />
          </span>
          <span className={styles.flyer} aria-hidden="true">
            <TicketIcon size={14} />
          </span>
          <span className={styles.flyer} aria-hidden="true">
            <TicketIcon size={14} />
          </span>
          <TicketIcon size={20} />
        </span>
        Купить билеты без комиссии
      </ButtonLink>
    </div>
  )
}
