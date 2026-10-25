import type { MetadataRoute } from 'next'

import { SITE_URL } from '@/lib/site'
import { listPeople } from '@/modules/people'
import { getSiteShows } from '@/app/(frontend)/site-data'
import { listPublishedShows } from '@/modules/shows'

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
  { path: '/school', priority: 0.6 },
  { path: '/contacts', priority: 0.6 },
  { path: '/site-map', priority: 0.2 },
]

// На сервере sitemap — route handler: connection() его пререндер не останавливает, поэтому при
// сборке он строится из демо-набора и обновляется из CMS раз в час. В статической сборке — как есть.
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const data = await getSiteShows()
  const url = (path: string) => `${SITE_URL}${path}`
  return [
    ...SECTIONS.map(({ path, priority }) => ({ url: url(path), priority })),
    ...listPublishedShows(data).map((show) => ({ url: url(`/shows/${show.slug}`), priority: 0.8 })),
    ...listPeople(data).map((person) => ({ url: url(`/people/${person.slug}`), priority: 0.4 })),
  ]
}
