import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { pageOpenGraph } from '@/lib/site'
import { personBios } from '@/modules/content'
import { getPersonProfile, listPeople, type PersonRole } from '@/modules/people'
import { formatPerformanceDate, getShowsData, plural } from '@/modules/shows'

import { reveal } from '@/components/ui/reveal'
import styles from './person.module.css'
import { personPhotos } from '@/components/people/personPhotos'
import { Gallery } from '@/components/show/Gallery'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { PageCrumbs } from '@/components/ui/PageCrumbs'
import { PersonAvatar } from '@/components/ui/PersonAvatar'
import { TicketIcon } from '@/components/ui/TicketIcon'

type Params = { slug: string }

export const dynamicParams = false

export function generateStaticParams(): Params[] {
  return listPeople(getShowsData()).map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params
  const profile = getPersonProfile(getShowsData(), slug, new Date())
  if (!profile) return {}
  const titles = [...profile.shows, ...profile.archive].map((s) => `«${s.title}»`)
  const description = titles.length
    ? `${profile.person.name} в спектаклях модного театра TURDUS: ${titles.join(', ')}.`
    : `${profile.person.name} — модный театр TURDUS.`
  const photo = personPhotos[profile.person.slug]
  return {
    title: profile.person.name,
    description,
    alternates: { canonical: `/people/${profile.person.slug}` },
    openGraph: pageOpenGraph(profile.person.name, photo?.src, description),
  }
}

/** Какая роль: «Роль — Шанель» для персонажей, иначе строка состава («Режиссёр»). */
function RoleLine({ roles }: { roles: PersonRole[] }) {
  const characters = roles.filter((r) => r.kind === 'character').map((r) => r.title)
  const credits = roles.filter((r) => r.kind === 'credit').map((r) => r.title)
  return (
    <p className={styles.roleNames}>
      {characters.length > 0 && (
        <>
          <span className={styles.roleLabel}>{characters.length > 1 ? 'Роли' : 'Роль'}</span>{' '}
          {characters.join(', ')}
        </>
      )}
      {/* Есть персонаж — строка состава мельче под ним; нет — она и есть роль. */}
      {characters.length > 0 && credits.length > 0 ? (
        <span className={styles.roleCredit}>{credits.join(', ')}</span>
      ) : (
        credits.join(', ')
      )}
    </p>
  )
}

/** Заголовок блока о человеке: актёр, если выходит на сцену, иначе — по основной работе. */
const ABOUT_TITLES: Record<string, string> = {
  'Актёрские работы': 'Об актёре',
  Режиссура: 'О режиссёре',
  Хореография: 'О хореографе',
  Сценография: 'О художнике',
  Драматургия: 'Об авторе',
  Продюсирование: 'О продюсере',
}
const aboutTitle = (fields: string[]) =>
  fields.includes('Актёрские работы')
    ? ABOUT_TITLES['Актёрские работы']!
    : (fields.map((f) => ABOUT_TITLES[f]).find(Boolean) ?? 'Об участнике')

/**
 * Страница актёра (и других людей театра): шапка с направлениями и цифрами, «Об актёре», роли
 * хронологией (репертуар по ближайшей дате, ниже архив), внизу — фото масонри-сеткой.
 * Только данные из составов: биографию и личные фото театр ещё не передал.
 */
export default async function PersonPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const profile = getPersonProfile(getShowsData(), slug, new Date())
  if (!profile) notFound()
  const { person, fields, shows, archive, gallery, stats } = profile
  const bio = personBios[person.slug]
  // Ближайшие показы — выше; спектакли без дат — в конце репертуара.
  const timeline = [...shows].sort(
    (a, b) =>
      (a.next ? Date.parse(a.next.startsAt) : Infinity) -
      (b.next ? Date.parse(b.next.startsAt) : Infinity),
  )

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

      <header className={styles.head} {...reveal(0)}>
        {/* Портрет — если подписан на сайте театра; иначе инициалы. */}
        <PersonAvatar
          name={person.name}
          photo={personPhotos[person.slug]}
          className={styles.avatar}
        />
        <div className={styles.headText}>
          <p className={styles.fields}>{fields.join(' · ')}</p>
          <h1 className={styles.title}>{person.name}</h1>
          <p className={styles.subtitle}>Модный театр TURDUS</p>
        </div>
      </header>

      <ul className={styles.stats} aria-label="Коротко" {...reveal(1)}>
        <li>
          <b>{stats.shows}</b> {plural(stats.shows, 'спектакль', 'спектакля', 'спектаклей')}
        </li>
        <li>
          <b>{stats.roles}</b> {plural(stats.roles, 'роль', 'роли', 'ролей')}
        </li>
        <li>
          <b>{stats.upcoming}</b>{' '}
          {plural(stats.upcoming, 'ближайший показ', 'ближайших показа', 'ближайших показов')}
        </li>
        {archive.length > 0 && (
          <li>
            <b>{archive.length}</b> в архиве
          </li>
        )}
      </ul>

      <section className={styles.about} aria-labelledby="about-title" {...reveal()}>
        <h2 id="about-title" className={styles.sectionTitle}>
          {aboutTitle(fields)}
        </h2>
        {bio ? (
          <div className={styles.bio}>
            <p className={styles.bioTitle}>{bio.title}</p>
            {bio.paragraphs.map((text) => (
              <p key={text}>{text}</p>
            ))}
            {bio.works && (
              <>
                <p className={styles.bioWorksTitle}>Спектакли</p>
                <ul className={styles.bioWorks}>
                  {bio.works.map((work) => (
                    <li key={work}>{work}</li>
                  ))}
                </ul>
              </>
            )}
            <p className={styles.bioSource}>Источник: {bio.source}</p>
          </div>
        ) : (
          // ЗАГЛУШКА: текст биографии — после согласования с театром.
          <p className={styles.placeholder}>
            Биография и фото появятся после согласования с театром.
          </p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="roles-title">
        <h2 id="roles-title" className={styles.sectionTitle}>
          Роли в спектаклях
        </h2>
        {/* Хронология: идущий репертуар по ближайшей дате, ниже — архив. */}
        <ol className={styles.tl}>
          {timeline.length > 0 && (
            <li className={styles.tlGroup}>
              Идущий репертуар <span className={styles.count}>{timeline.length}</span>
            </li>
          )}
          {timeline.map((show, i) => {
            const next = show.next ? formatPerformanceDate(show.next.startsAt) : null
            return (
              <li key={show.slug} className={styles.tlItem} {...reveal(i)}>
                <p className={styles.tlWhen}>
                  {next ? (
                    <>
                      <b>{next.day}</b> {next.month}
                      <span>
                        {next.weekday}, {next.time}
                      </span>
                    </>
                  ) : (
                    <span>Даты скоро</span>
                  )}
                </p>
                <span className={styles.tlDot} aria-hidden="true" />
                <div className={styles.tlCard}>
                  <Link href={`/shows/${show.slug}`} className={styles.tlThumb} tabIndex={-1}>
                    <Image src={show.photoUrl ?? show.posterUrl} alt="" fill sizes="6rem" />
                  </Link>
                  <div className={styles.tlText}>
                    <RoleLine roles={show.roles} />
                    <p className={styles.tlShow}>
                      <Link href={`/shows/${show.slug}`}>{show.title}</Link>
                    </p>
                    <p className={styles.tlMeta}>
                      {[show.genre, show.next?.venueTitle].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {show.next && (
                    <ButtonLink
                      href={`/shows/${show.slug}?date=${show.next.id}#tickets`}
                      className={styles.tlCta}
                    >
                      <TicketIcon /> Билеты
                    </ButtonLink>
                  )}
                </div>
              </li>
            )
          })}
          {archive.length > 0 && (
            <li className={styles.tlGroup}>
              Архив <span className={styles.count}>{archive.length}</span>
            </li>
          )}
          {archive.map((show, i) => (
            <li key={show.slug} className={`${styles.tlItem} ${styles.tlPast}`} {...reveal(i)}>
              <p className={styles.tlWhen}>
                <span>Сыграно</span>
              </p>
              <span className={styles.tlDot} aria-hidden="true" />
              <div className={styles.tlCard}>
                <div className={styles.tlThumb}>
                  <Image src={show.posterUrl} alt="" fill sizes="6rem" />
                </div>
                <div className={styles.tlText}>
                  <RoleLine roles={show.roles} />
                  <p className={styles.tlShow}>{show.title}</p>
                  {show.genre && <p className={styles.tlMeta}>{show.genre}</p>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {gallery.length > 0 && (
        <section className={styles.section} aria-labelledby="photos-title">
          <h2 id="photos-title" className={styles.sectionTitle}>
            Фото из спектаклей
          </h2>
          <Gallery
            label={`Фото из спектаклей: ${shows.map((s) => `«${s.title}»`).join(', ')}`}
            mobile="masonry"
            items={gallery.map((photo) => ({
              src: photo.src,
              alt: `Сцена из спектакля «${photo.showTitle}»`,
              caption: photo.showTitle,
            }))}
          />
        </section>
      )}
    </div>
  )
}
