import type { Metadata } from 'next'
import Link from 'next/link'

import { PageCrumbs } from '@/components/ui/PageCrumbs'
import { getSiteContent, getSiteShows } from '@/app/(frontend)/site-data'

import head from '../page-head.module.css'
import styles from './site-map.module.css'

export const metadata: Metadata = {
  alternates: { canonical: '/site-map' },
  title: 'Карта сайта',
}

const MAIN = [
  { href: '/', title: 'Главная' },
  { href: '/afisha', title: 'Афиша' },
  { href: '/about', title: 'О театре' },
  { href: '/venues', title: 'Площадки' },
  { href: '/repertoire', title: 'Репертуар' },
  { href: '/troupe', title: 'Труппа' },
  { href: '/leadership', title: 'Руководство' },
  { href: '/news', title: 'Архив новостей' },
  { href: '/corporate', title: 'Корпоративы' },
  { href: '/school', title: 'Актёрская школа' },
  { href: '/contacts', title: 'Контакты' },
  { href: '/login', title: 'Вход в личный кабинет' },
  { href: '/register', title: 'Регистрация' },
]

/** Все разделы, спектакли и документы сайта — из тех же данных, что и страницы. */
export default async function SiteMapPage() {
  const [data, { legalDocuments }] = await Promise.all([getSiteShows(), getSiteContent()])
  const shows = [...data.shows].sort((a, b) => a.title.localeCompare(b.title, 'ru'))
  const sections = [
    { title: 'Разделы', links: MAIN },
    { title: 'Спектакли', links: shows.map((s) => ({ href: `/shows/${s.slug}`, title: s.title })) },
    {
      title: 'Документы',
      links: legalDocuments.map((d) => ({ href: `/documents/${d.slug}`, title: d.title })),
    },
  ]

  return (
    <div className="container">
      <header className={head.head}>
        <PageCrumbs items={[{ label: 'Главная', href: '/' }, { label: 'Карта сайта' }]} />
        <h1 className={head.title}>Карта сайта</h1>
      </header>
      <div className={styles.grid}>
        {sections.map((section) => (
          <section key={section.title} aria-labelledby={`map-${section.title}`}>
            <h2 id={`map-${section.title}`} className={styles.title}>
              {section.title}
            </h2>
            <ul className={styles.list}>
              {section.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.title}</Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
