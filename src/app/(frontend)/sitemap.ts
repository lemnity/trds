import type { MetadataRoute } from 'next'

import { SITE_URL } from '@/lib/site'
import { listPeople } from '@/modules/people'
import { getShowsData, listPublishedShows } from '@/modules/shows'

export const dynamic = 'force-static'

/**
 * Публичные страницы: разделы, спектакли, люди. Не входят: кабинет, вход, оформление заказа и
 * документы (пока заглушки, закрыты от индексации — добавить, когда театр передаст тексты).
 */
const SECTIONS: { path: string; priority: number }[] = [
  { path: '/', priority: 1 },
  { path: '/afisha', priority: 0.9 },
  { path: '/repertoire', priority: 0.8 },
  { path: '/about', priority: 0.6 },
  { path: '/venues', priority: 0.6 },
  { path: '/troupe', priority: 0.6 },
  { path: '/leadership', priority: 0.5 },
  { path: '/news', priority: 0.5 },
  { path: '/corporate', priority: 0.6 },
  { path: '/contacts', priority: 0.6 },
  { path: '/site-map', priority: 0.2 },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const data = getShowsData()
  const url = (path: string) => `${SITE_URL}${path}`
  return [
    ...SECTIONS.map(({ path, priority }) => ({ url: url(path), priority })),
    ...listPublishedShows(data).map((show) => ({ url: url(`/shows/${show.slug}`), priority: 0.8 })),
    ...listPeople(data).map((person) => ({ url: url(`/people/${person.slug}`), priority: 0.4 })),
  ]
}
