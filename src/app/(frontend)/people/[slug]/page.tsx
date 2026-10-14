import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getPersonPage, listPeople } from '@/modules/people'
import { formatPerformanceDate, getShowsData } from '@/modules/shows'

import styles from './person.module.css'
import { PageCrumbs } from '@/components/ui/PageCrumbs'
import { PersonAvatar } from '@/components/ui/PersonAvatar'

type Params = { slug: string }

export const dynamicParams = false

export function generateStaticParams(): Params[] {
  return listPeople(getShowsData()).map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params
  const page = getPersonPage(getShowsData(), slug, new Date())
  if (!page) return {}
  return {
    title: page.person.name,
    description: `${page.person.name} в спектаклях модного театра TURDUS.`,
  }
}

export default async function PersonPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const page = getPersonPage(getShowsData(), slug, new Date())
  if (!page) notFound()
  const { person, works } = page
  // Одна карточка на спектакль: роли и персонажи человека в нём — одной строкой.
  const byShow = new Map<string, { title: string; nextStartsAt: string | null; roles: string[] }>()
  for (const work of works) {
    const entry = byShow.get(work.show.slug) ?? {
      title: work.show.title,
      nextStartsAt: work.nextStartsAt,
      roles: [],
    }
    const label = work.character ? `${work.character} (${work.role.toLowerCase()})` : work.role
    if (!entry.roles.includes(label)) entry.roles.push(label)
    byShow.set(work.show.slug, entry)
  }

  return (
    <div className="container">
      <PageCrumbs
        className={styles.crumbs}
        items={[
          { label: 'Главная', href: '/' },
          { label: 'Афиша', href: '/afisha' },
          { label: person.name },
        ]}
      />

      <header className={styles.head}>
        {/* Фото людей театр ещё не передал — показываем инициалы. */}
        <PersonAvatar name={person.name} className={styles.avatar} />
        <div>
          <h1 className={styles.title}>{person.name}</h1>
          <p className={styles.subtitle}>Модный театр TURDUS</p>
        </div>
      </header>

      <div className={styles.layout}>
        <section aria-labelledby="works-title">
          <h2 id="works-title" className={styles.sectionTitle}>
            Спектакли
          </h2>
          <ul className={styles.works}>
            {[...byShow].map(([showSlug, work]) => {
              const next = work.nextStartsAt ? formatPerformanceDate(work.nextStartsAt) : null
              return (
                <li key={showSlug} className={styles.work}>
                  <Link href={`/shows/${showSlug}`} className={styles.workTitle}>
                    {work.title}
                  </Link>
                  <p className={styles.workRole}>{work.roles.join(', ')}</p>
                  <p className={styles.workNext}>
                    {next
                      ? `Ближайший показ: ${next.longDate}, ${next.time}`
                      : 'Ближайших показов нет'}
                  </p>
                </li>
              )
            })}
          </ul>
        </section>

        <aside className={styles.bio} aria-labelledby="bio-title">
          <h2 id="bio-title" className={styles.sectionTitle}>
            О человеке
          </h2>
          <p>Биография и фото появятся после согласования с театром.</p>
        </aside>
      </div>
    </div>
  )
}
