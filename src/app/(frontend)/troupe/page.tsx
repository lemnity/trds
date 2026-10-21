import type { Metadata } from 'next'
import Link from 'next/link'

import { personPhotos } from '@/components/people/personPhotos'
import { PersonAvatar } from '@/components/ui/PersonAvatar'
import { getPersonProfile, listPeople } from '@/modules/people'
import { getShowsData } from '@/modules/shows'

import head from '../page-head.module.css'
import { reveal } from '@/components/ui/reveal'
import styles from '../theatre.module.css'

export const metadata: Metadata = {
  alternates: { canonical: '/troupe' },
  title: 'Труппа',
  description: 'Актёры, режиссёры и создатели спектаклей модного театра TURDUS.',
}

/** Порядок групп: сначала актёры, потом создатели. */
const ORDER = [
  'Актёрские работы',
  'Режиссура',
  'Драматургия',
  'Хореография',
  'Сценография',
  'Продюсирование',
  'Звук и свет',
]
const GROUP_TITLES: Record<string, string> = { 'Актёрские работы': 'Актёры' }

/**
 * Труппа и создатели — все люди из составов (репертуар и архив), сгруппированы по
 * направлению. Человек в нескольких направлениях — в каждой группе.
 */
export default function TroupePage() {
  const data = getShowsData()
  const now = new Date()
  const groups = new Map<string, { slug: string; name: string }[]>()
  for (const person of listPeople(data)) {
    for (const field of getPersonProfile(data, person.slug, now)?.fields ?? []) {
      groups.set(field, [...(groups.get(field) ?? []), person])
    }
  }
  const sorted = [...groups].sort(
    ([a], [b]) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99),
  )
  return (
    <div className="container">
      <header className={head.head}>
        <h1 className={head.title}>Труппа</h1>
        <p className={head.lead}>
          Актёры и создатели спектаклей — по составам репертуара и архива.
        </p>
      </header>
      {sorted.map(([field, people]) => (
        <section key={field} className={styles.group} aria-label={GROUP_TITLES[field] ?? field}>
          <h2 className={styles.groupTitle}>
            {GROUP_TITLES[field] ?? field} <span className={styles.count}>{people.length}</span>
          </h2>
          <ul className={styles.people}>
            {people.map((p, i) => (
              <li key={p.slug} {...reveal(i % 7)}>
                <Link href={`/people/${p.slug}`} className={styles.person}>
                  <PersonAvatar
                    name={p.name}
                    photo={personPhotos[p.slug]}
                    size="md"
                    className={styles.avatar}
                  />
                  <span className={styles.personName}>
                    {/* Имя и фамилия — на разных строках: колонки ровные, длинные фамилии не рвутся. */}
                    {p.name.split(' ')[0]}
                    <br />
                    {p.name.split(' ').slice(1).join(' ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
