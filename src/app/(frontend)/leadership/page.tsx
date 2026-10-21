import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

import { personPhotos } from '@/components/people/personPhotos'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { reveal } from '@/components/ui/reveal'
import { leadership } from '@/modules/content'
import { getPersonProfile, personSlug } from '@/modules/people'
import { getShowsData, plural } from '@/modules/shows'

import styles from './leadership.module.css'

export const metadata: Metadata = {
  alternates: { canonical: '/leadership' },
  title: 'Руководство',
  description: 'Основатели и художественный руководитель модного театра TURDUS.',
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')

/**
 * Руководство — журнальные развороты: портрет (или типографская панель, если фото нет),
 * должность, имя, прямая речь с сайта театра, цифры и спектакли в репертуаре.
 * Должности и цитаты — дословно (источники в modules/content).
 */
export default function LeadershipPage() {
  const data = getShowsData()
  const now = new Date()
  return (
    <div className={styles.page}>
      <header className={`container ${styles.intro}`} {...reveal()}>
        <p className={styles.kicker}>Модный театр TURDUS</p>
        <h1 className={styles.title}>Руководство</h1>
        <p className={styles.lead}>
          Люди, которые превращают бары, особняки и квартиры Екатеринбурга в сцену.
        </p>
      </header>

      {leadership.map((leader, i) => {
        const slug = personSlug(leader.name)
        const photo = personPhotos[slug]
        const profile = getPersonProfile(data, slug, now)
        const shows = profile?.shows ?? []
        const archive = profile?.archive ?? []
        return (
          <article
            key={leader.name}
            className={`container ${styles.spread}`}
            data-flip={i % 2 === 1 || undefined}
            aria-labelledby={`leader-${slug}`}
          >
            <div className={styles.portrait} {...reveal()}>
              {photo ? (
                <Image src={photo} alt={leader.name} fill sizes="(min-width: 60rem) 40vw, 100vw" />
              ) : (
                // Фото театр ещё не передал — типографская панель вместо портрета.
                <div className={styles.monogram} aria-hidden="true">
                  {initials(leader.name)}
                </div>
              )}
              <span className={styles.index}>{String(i + 1).padStart(2, '0')}</span>
            </div>

            <div className={styles.text}>
              <p className={styles.position} {...reveal(1)}>
                {leader.position}
              </p>
              <h2 id={`leader-${slug}`} className={styles.name} {...reveal(2)}>
                {leader.name}
              </h2>

              {leader.quote && (
                <figure className={styles.quote} {...reveal(3)}>
                  <blockquote>
                    <p>{leader.quote.text}</p>
                  </blockquote>
                  <figcaption>— {leader.quote.about}</figcaption>
                </figure>
              )}

              <ul className={styles.facts} {...reveal(4)}>
                <li>
                  <b>{shows.length}</b>
                  {plural(shows.length, 'спектакль', 'спектакля', 'спектаклей')} в репертуаре
                </li>
                {archive.length > 0 && (
                  <li>
                    <b>{archive.length}</b>
                    {plural(archive.length, 'постановка', 'постановки', 'постановок')} в архиве
                  </li>
                )}
                {profile && profile.stats.roles > 0 && (
                  <li>
                    <b>{profile.stats.roles}</b>
                    {plural(profile.stats.roles, 'роль', 'роли', 'ролей')} в репертуаре
                  </li>
                )}
              </ul>

              {shows.length > 0 && (
                <div className={styles.shows} {...reveal(5)}>
                  <p className={styles.showsTitle}>Сейчас в репертуаре</p>
                  <ul>
                    {shows.map((show) => (
                      <li key={show.slug}>
                        <Link href={`/shows/${show.slug}`}>{show.title}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div {...reveal(6)}>
                <ButtonLink href={`/people/${slug}`} variant="outline">
                  Все роли и работы →
                </ButtonLink>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
