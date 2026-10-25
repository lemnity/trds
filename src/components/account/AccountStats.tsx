'use client'

import { formatRub } from '@/lib/money'

import { reveal } from '../ui/reveal'
import styles from './Account.module.css'
import { accountStatLabel } from './stats-view'
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

  const upcoming = ticketData?.upcoming.length ?? 0
  // Несколько билетов на один показ — один спектакль.
  const visited = new Set(ticketData?.past.map((t) => `${t.show?.slug}|${t.startsAt}`)).size
  const friends = data?.referral.qualified ?? 0
  const stats = [
    {
      id: 'upcoming',
      value: ticketsPending ? '—' : String(upcoming),
      label: accountStatLabel('upcoming', ticketsPending ? null : upcoming),
      href: '#tickets',
    },
    {
      id: 'visited',
      value: ticketsPending ? '—' : String(visited),
      label: accountStatLabel('visited', ticketsPending ? null : visited),
      href: '#tickets',
    },
    {
      id: 'balance',
      value: pending ? '—' : formatRub(data?.balanceKopecks ?? 0),
      // Сумма в рублях («500 ₽ бонусов») — подпись от числа не зависит.
      label: 'бонусов на счёте',
      href: '#bonuses',
    },
    {
      id: 'friends',
      value: pending ? '—' : String(friends),
      label: accountStatLabel('friends', pending ? null : friends),
      href: '#bonuses',
    },
  ]

  return (
    <ul className={styles.stats} aria-label="Коротко" aria-busy={loyalty.status === 'loading'}>
      {stats.map((stat, i) => (
        <li key={stat.id} {...reveal(i)}>
          <a href={stat.href} className={styles.stat}>
            <b>{stat.value}</b>
            <span>{stat.label}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
