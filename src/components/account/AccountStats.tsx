'use client'

import { formatRub } from '@/lib/money'

import { reveal } from '../ui/reveal'
import styles from './Account.module.css'
import { useLoyalty } from './useLoyalty'

/** Цифры сверху кабинета. Билеты — с сервера страницы, бонусы и друзья — из useLoyalty. */
export function AccountStats({ upcoming, past }: { upcoming: number; past: number }) {
  const loyalty = useLoyalty()
  const data = loyalty.status === 'ready' ? loyalty.data : null
  // Пока грузится или недоступно — прочерк, а не ложный ноль.
  const pending = loyalty.status === 'loading' || loyalty.status === 'unavailable'

  const stats = [
    { value: String(upcoming), label: 'билетов впереди', href: '#tickets' },
    { value: String(past), label: 'спектаклей посещено', href: '#tickets' },
    {
      value: pending ? '—' : formatRub(data?.balanceKopecks ?? 0),
      label: 'бонусов на счёте',
      href: '#bonuses',
    },
    {
      value: pending ? '—' : String(data?.referral.qualified ?? 0),
      label: 'друзей приглашено',
      href: '#bonuses',
    },
  ]

  return (
    <ul className={styles.stats} aria-label="Коротко" aria-busy={loyalty.status === 'loading'}>
      {stats.map((stat, i) => (
        <li key={stat.label} {...reveal(i)}>
          <a href={stat.href} className={styles.stat}>
            <b>{stat.value}</b>
            <span>{stat.label}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
