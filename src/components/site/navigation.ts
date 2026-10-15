import { VENUE_KIND_LABELS, type VenueKind } from '@/modules/shows'

export type NavLink = { href: string; label: string }
export type NavGroup = { title: string; links: NavLink[] }
/**
 * `mega`: на широком экране раздел — кнопка, открывающая мега-меню (колонки + ближайший
 * спектакль), а не ссылка на страницу.
 */
export type NavItem = NavLink & { children?: NavLink[]; mega?: boolean }

/** Площадки в подменю «Афиша» — фильтры афиши по типу места. */
const VENUES: VenueKind[] = ['stage', 'bar', 'restaurant', 'loft', 'apartment', 'city']

/**
 * Главное меню шапки. Подменю — только существующие страницы и фильтры афиши (ссылок в
 * никуда не показываем). Новые разделы добавляются сюда — шапка подстроится.
 */
/** Колонки мега-меню «Афиша» после «Наших спектаклей» (месяцы добавляются из данных афиши). */
export const AFISHA_GROUPS: NavGroup[] = [
  {
    title: 'Площадки',
    links: VENUES.map((kind) => ({ href: `/afisha?kind=${kind}`, label: VENUE_KIND_LABELS[kind] })),
  },
]

export const MAIN_NAV: NavItem[] = [
  {
    href: '/afisha',
    label: 'Афиша',
    mega: true,
    children: [{ href: '/afisha', label: 'Вся афиша' }, ...AFISHA_GROUPS.flatMap((g) => g.links)],
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
