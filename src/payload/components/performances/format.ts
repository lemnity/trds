import { THEATRE_TIME_ZONE } from '@/modules/shows'

import type { SalesStatus } from './salesState'

const dateTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: THEATRE_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** «пт, 4 декабря 2026, 19:00» — время театра; без дня недели — «4 декабря 2026, 19:00». */
export function formatTheatreDateTime(iso: string, { weekday = true } = {}): string {
  const p = Object.fromEntries(dateTime.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  const date = `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`
  return weekday ? `${p.weekday}, ${date}` : date
}

/** Продажи показа одной строкой: «открыты» / «откроются <дата>» / «нет цен» / «закрыты». */
export function salesStatusText(status: SalesStatus): string {
  switch (status.kind) {
    case 'open':
      return 'открыты'
    case 'opensLater':
      return `откроются ${formatTheatreDateTime(status.opensAt, { weekday: false })}`
    case 'noPrices':
      return 'нет цен'
    case 'closed':
      return 'закрыты'
  }
}
