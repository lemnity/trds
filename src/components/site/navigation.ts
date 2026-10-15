import { VENUE_KIND_LABELS, type VenueKind } from '@/modules/shows'

export type NavLink = { href: string; label: string }
export type NavItem = NavLink & { children?: NavLink[] }

/** Площадки в подменю «Афиша» — фильтры афиши по типу места. */
const VENUES: VenueKind[] = ['stage', 'bar', 'restaurant', 'loft', 'apartment', 'city']

/**
 * Главное меню шапки. Подменю — только существующие страницы и фильтры афиши (ссылок в
 * никуда не показываем). Новые разделы добавляются сюда — шапка подстроится.
 */
export const MAIN_NAV: NavItem[] = [
  {
    href: '/afisha',
    label: 'Афиша',
    children: [
      { href: '/afisha', label: 'Все спектакли' },
      { href: '/afisha?premiere=1', label: 'Премьеры' },
      { href: '/afisha?kids=1', label: 'Детям' },
      ...VENUES.map((kind) => ({ href: `/afisha?kind=${kind}`, label: VENUE_KIND_LABELS[kind] })),
    ],
  },
  {
    href: '/about',
    label: 'О театре',
    children: [
      { href: '/about', label: 'О театре' },
      { href: '/news', label: 'Новости' },
      { href: '/#reviews', label: 'Отзывы' },
    ],
  },
  { href: '#contacts', label: 'Контакты' },
]
