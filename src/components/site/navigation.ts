import { VENUE_KIND_LABELS, type VenueKind } from '@/modules/shows'

import type { NavIconName } from './NavIcon'

export type NavLink = { href: string; label: string; icon?: NavIconName }
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
      { href: '/about', label: 'О театре', icon: 'theatre' },
      { href: '/venues', label: 'Площадки', icon: 'venues' },
      { href: '/repertoire', label: 'Репертуар', icon: 'repertoire' },
      { href: '/troupe', label: 'Труппа', icon: 'troupe' },
      { href: '/leadership', label: 'Руководство', icon: 'leadership' },
      { href: '/#partners', label: 'Партнёры', icon: 'partners' },
      { href: '/news', label: 'Новости', icon: 'news' },
      { href: '/#reviews', label: 'Отзывы', icon: 'reviews' },
    ],
  },
  { href: '/contacts', label: 'Контакты' },
]

/**
 * «Актёрская школа» — заметная кнопка в шапке. Своей страницы пока нет, поэтому ведём на
 * страницу школы на действующем сайте театра (в новой вкладке); появится своя — заменить.
 */
export const SCHOOL_LINK = {
  href: 'https://teatrturdus.ru/theatre-school',
  label: 'Актёрская школа',
} as const

/**
 * Куда ведёт «Личный кабинет»: без входа — на страницу входа, после входа — в кабинет.
 * Сессий пока нет (вход по коду — T-050), поэтому всегда вход. С T-050 — проверка сессии
 * на сервере: /account без сессии перенаправляет на /login.
 */
export const ACCOUNT_HREF = '/login'
