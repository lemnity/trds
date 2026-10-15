import Image from 'next/image'
import Link from 'next/link'
import { Fragment } from 'react'

import { personSlug } from '@/modules/people'
import { formatAge, formatDuration, type Credit, type Show } from '@/modules/shows'

import styles from './ShowAbout.module.css'
import { PersonAvatar } from '../ui/PersonAvatar'
import { cardClass } from '../ui/card'

const isDirector = (c: Credit) => /режисс/i.test(c.role)
/** Актёрский состав: роли с персонажами или явные «В ролях» / «Действующие лица». */
const isCast = (c: Credit) =>
  /в ролях|действующие лица/i.test(c.role) || c.entries.some((e) => e.character)

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

const icons = {
  clock: (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 6v4l2.5 1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  person: (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <circle cx="10" cy="7" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M4 17c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  genre: (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path
        d="M8.5 11.5l3-3M7 9l-2 2a2.8 2.8 0 0 0 4 4l2-2M13 11l2-2a2.8 2.8 0 0 0-4-4L9 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  director: (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path
        d="M3.5 8.5h13v8h-13zM3.5 8.5l2-4.5M8 8.5l2-4.5M12.5 8.5l2-4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  ),
  camera: (
    <svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true">
      <path
        d="M3 6.5h3l1.5-2h5l1.5 2h3v9.5H3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="11" r="2.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
}

/** Актёры: одна карточка на человека; персонажи (и «в очередь») — подписью. */
const castCards = (show: Show) => {
  const byName = new Map<string, { roles: string[]; alternating: boolean }>()
  for (const credit of show.credits.filter(isCast))
    for (const e of credit.entries)
      for (const name of e.people) {
        const card = byName.get(name) ?? { roles: [], alternating: false }
        if (e.character && !card.roles.includes(e.character)) card.roles.push(e.character)
        if (e.people.length > 1) card.alternating = true
        byName.set(name, card)
      }
  return [...byName].map(([name, c]) => ({
    name,
    role: [c.roles.join(', '), c.alternating ? 'в очередь' : ''].filter(Boolean).join(' · '),
  }))
}

type AboutProps = {
  show: Show
  /** Шапка (название, плашки) — над описанием, рядом с правой колонкой. */
  intro?: React.ReactNode
  /** Цена и кнопка покупки — внизу карточки «О спектакле». */
  buy?: React.ReactNode
}

export function ShowAbout({ show, intro, buy }: AboutProps) {
  const directors = uniqueNames(show.credits.filter(isDirector))
  const duration = formatDuration(show.durationMinutes)
  const age = formatAge(show.ageLimit)
  const facts: Array<[keyof typeof icons, string, React.ReactNode]> = []
  if (duration) facts.push(['clock', 'Продолжительность', duration])
  if (age) facts.push(['person', 'Возраст', age])
  if (show.genre) facts.push(['genre', 'Жанр', show.genre])
  if (directors.length)
    facts.push(['director', 'Режиссёр', <PeopleLinks key="d" names={directors} />])
  const actors = castCards(show)
  const crew = show.credits.filter((c) => !isCast(c))
  // Видео у театра пока нет: медиа-карточка ведёт к фото. Кнопку Play без видео не показываем.
  const mediaPhoto = show.gallery[1] ?? show.gallery[0]

  return (
    <div className={styles.about}>
      {intro && <div className={styles.intro}>{intro}</div>}
      <div className={styles.main}>
        <h2 className="visually-hidden">О спектакле</h2>
        <div className={styles.prose}>
          {show.description.map((p, i) => (
            // Список статичен и не переупорядочивается.
            <p key={i}>{p}</p>
          ))}
        </div>

        {crew.length > 0 && (
          <section aria-labelledby={`${show.slug}-crew`}>
            <h3 id={`${show.slug}-crew`} className={styles.blockTitle}>
              Создатели
            </h3>
            <dl className={styles.castList}>
              {crew.map((credit) => (
                <div key={credit.role}>
                  <dt>{credit.role}</dt>
                  <dd>
                    <PeopleLinks names={uniqueNames([credit])} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {actors.length > 0 && (
          <section aria-labelledby={`${show.slug}-actors`} className={styles.performers}>
            <h3 id={`${show.slug}-actors`} className={styles.performersTitle}>
              Исполнители
            </h3>
            {/* Текст по референсу заказчика — подтвердить у театра (memory.md). */}
            <p className={styles.performersNote}>
              Театр оставляет за собой право замены исполнителей
            </p>
            <ul className={styles.actors}>
              {actors.map((a) => (
                <li key={a.name} className={styles.actor}>
                  {/* Фото людей театр ещё не передал — инициалы. */}
                  <PersonAvatar name={a.name} className={styles.avatar} />
                  <span className={styles.actorText}>
                    {a.role && <span className={styles.actorRole}>{a.role}</span>}
                    <Link href={`/people/${personSlug(a.name)}`} className={styles.actorName}>
                      {a.name}
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className={styles.sidebar} aria-label="Коротко о спектакле">
        {(facts.length > 0 || buy) && (
          <div className={cardClass(styles.factsCard)}>
            <p className={styles.factsTitle}>О спектакле</p>
            <dl className={styles.factList}>
              {facts.map(([icon, term, value]) => (
                <div key={term} className={styles.fact}>
                  <span className={styles.factIcon}>{icons[icon]}</span>
                  <div>
                    <dt>{term}</dt>
                    <dd>{value}</dd>
                  </div>
                </div>
              ))}
            </dl>
            {buy}
          </div>
        )}
        {mediaPhoto && (
          <a href="#photos" className={styles.media}>
            <Image src={mediaPhoto} alt="" fill sizes="(min-width: 60rem) 25vw, 100vw" />
            <span className={styles.mediaBadge}>
              <span className={styles.mediaIcon}>{icons.camera}</span>
              Смотреть фото · {show.gallery.length}
            </span>
          </a>
        )}
      </aside>
    </div>
  )
}
