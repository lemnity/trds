import Image from 'next/image'
import Link from 'next/link'
import { Fragment } from 'react'

import { personSlug } from '@/modules/people'
import { formatAge, formatDuration, type Credit, type Show } from '@/modules/shows'

import styles from './ShowAbout.module.css'

const isDirector = (c: Credit) => /режисс/i.test(c.role)
const isCast = (c: Credit) => /в ролях|действующие лица/i.test(c.role)

/** Имена через запятую, каждое — ссылка на страницу человека. */
export function PeopleLinks({ names }: { names: string[] }) {
  return (
    <>
      {names.map((name, i) => (
        <Fragment key={name}>
          {i > 0 && ', '}
          <Link href={`/people/${personSlug(name)}`} className={styles.person}>
            {name}
          </Link>
        </Fragment>
      ))}
    </>
  )
}

const uniqueNames = (credits: Credit[]) => [
  ...new Set(credits.flatMap((c) => c.entries.flatMap((e) => e.people))),
]

export function ShowAbout({ show }: { show: Show }) {
  const directors = uniqueNames(show.credits.filter(isDirector))
  const cast = uniqueNames(show.credits.filter(isCast))
  const facts: Array<[string, React.ReactNode]> = []
  const duration = formatDuration(show.durationMinutes)
  const age = formatAge(show.ageLimit)
  if (duration) facts.push(['Длительность', duration])
  if (age) facts.push(['Возраст', age])
  if (show.genre) facts.push(['Жанр', show.genre])
  if (directors.length) facts.push(['Режиссёр', <PeopleLinks key="d" names={directors} />])
  if (cast.length) facts.push(['В ролях', <PeopleLinks key="c" names={cast} />])
  const collage = show.gallery.slice(0, 2)

  return (
    <div className={styles.about}>
      <div>
        <h2 className={styles.title}>О спектакле</h2>
        <div className={styles.prose}>
          {show.description.map((p, i) => (
            // Список статичен и не переупорядочивается.
            <p key={i}>{p}</p>
          ))}
        </div>
        {collage.length > 0 && (
          <div className={styles.collage} data-count={collage.length}>
            {collage.map((src, i) => (
              <div key={src} className={styles.photo}>
                <Image
                  src={src}
                  alt={`Сцена из спектакля «${show.title}»`}
                  fill
                  sizes={
                    i === 0 ? '(min-width: 60rem) 20vw, 40vw' : '(min-width: 60rem) 35vw, 60vw'
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>
      {facts.length > 0 && (
        <dl className={styles.facts}>
          {facts.map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)

export function ShowPeople({ show }: { show: Show }) {
  return (
    <div className={styles.people}>
      {show.credits.map((credit) => (
        <section key={credit.role} aria-labelledby={`role-${personSlug(credit.role)}`}>
          <h3 id={`role-${personSlug(credit.role)}`} className={styles.roleTitle}>
            {credit.role}
          </h3>
          <ul className={styles.cards}>
            {credit.entries.flatMap((entry) =>
              entry.people.map((name) => (
                <li key={`${entry.character ?? ''}-${name}`} className={styles.card}>
                  <span className={styles.avatar} aria-hidden="true">
                    {initials(name)}
                  </span>
                  <span>
                    <Link href={`/people/${personSlug(name)}`} className={styles.cardName}>
                      {name}
                    </Link>
                    {entry.character && <span className={styles.character}>{entry.character}</span>}
                    {entry.people.length > 1 && <span className={styles.character}>в очередь</span>}
                  </span>
                </li>
              )),
            )}
          </ul>
        </section>
      ))}
    </div>
  )
}
