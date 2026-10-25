'use client'

import { formatRub } from '@/lib/money'

import { reveal } from '../ui/reveal'
import styles from './Account.module.css'
import { useAccountTickets } from './useAccountTickets'
import { useLoyalty } from './useLoyalty'

/** Цифры сверху кабинета. Билеты — из useAccountTickets, бонусы и друзья — из useLoyalty. */
export function AccountStats() {
  const loyalty = useLoyalty()
  const tickets = useAccountTickets()
  const ticketData = tickets.status === 'ready' ? tickets.data : null
  // Пока билеты грузятся или недоступны — прочерк, а не ложный ноль.
  const ticketsPending = tickets.status === 'loading' || tickets.status === 'unavailable'
  const data = loyalty.status === 'ready' ? loyalty.data : null
  // Пока грузится или недоступно — прочерк, а не ложный ноль.
  const pending = loyalty.status === 'loading' || loyalty.status === 'unavailable'

  const stats = [
    {
      value: ticketsPending ? '—' : String(ticketData?.upcoming.length ?? 0),
      label: 'билетов впереди',
      href: '#tickets',
    },
    {
      // Несколько билетов на один показ — один спектакль.
      value: ticketsPending
        ? '—'
        : String(new Set(ticketData?.past.map((t) => `${t.show?.slug}|${t.startsAt}`)).size),
      label: 'спектаклей посещено',
      href: '#tickets',
    },
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
