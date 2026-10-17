'use client'

import { buttonVariants } from '@heroui/styles'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

import { endSession, useSession } from '../auth/session'
import styles from './SiteHeader.module.css'

const UserIcon = () => (
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
)

/** Пункты кабинета для вошедшего (страницы кабинета — T-051, T-060, профиль). */
export const ACCOUNT_LINKS = [
  { href: '/account#tickets', label: 'Мои билеты' },
  { href: '/account#bonuses', label: 'Бонусы' },
  { href: '/account#profile', label: 'Профиль' },
]

export const GUEST_LINKS = [
  { href: '/login', label: 'Войти' },
  { href: '/register', label: 'Регистрация' },
]

/**
 * «Личный кабинет» с подменю (паттерн «кнопка раскрытия»): гостю — «Войти» и «Регистрация»,
 * вошедшему — билеты, бонусы, профиль и «Выйти из аккаунта». Закрывается Esc и кликом мимо.
 */
export function AccountMenu() {
  const session = useSession()
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  // Переход по ссылке меню — закрыть.
  const [openedAt, setOpenedAt] = useState(pathname)
  if (open && openedAt !== pathname) {
    setOpen(false)
    setOpenedAt(pathname)
  }

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
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

  const toggle = () => {
    setOpenedAt(pathname)
    setOpen(!open)
  }

  const logout = () => {
    endSession()
    setOpen(false)
    router.push('/')
  }

  const firstName = session?.name.split(' ')[0]

  return (
    <div ref={rootRef} className={styles.accountRoot}>
      <button
        ref={buttonRef}
        type="button"
        className={buttonVariants({
          variant: 'outline',
          className: `${styles.account} ${styles.accountButton}`,
        })}
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        onClick={toggle}
      >
        <UserIcon />
        <span className={styles.accountLabel}>{firstName ?? 'Личный кабинет'}</span>
        <svg
          viewBox="0 0 20 20"
          width="14"
          height="14"
          aria-hidden="true"
          className={styles.accountChevron}
        >
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

      <div id={`${id}-menu`} className={styles.accountMenu} hidden={!open}>
        {session ? (
          <>
            <div className={styles.accountWho}>
              <b>{session.name}</b>
              <span>{session.email}</span>
              {session.demo && <span className={styles.accountDemo}>Демо-вход</span>}
            </div>
            <ul>
              {ACCOUNT_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className={styles.accountLink} onClick={() => setOpen(false)}>
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className={`${styles.accountLink} ${styles.accountLogout}`}
                  onClick={logout}
                >
                  Выйти из аккаунта
                </button>
              </li>
            </ul>
          </>
        ) : (
          <ul>
            {GUEST_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={styles.accountLink} onClick={() => setOpen(false)}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
