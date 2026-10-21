import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

import { formatRub } from '@/lib/money'
import { pageOpenGraph } from '@/lib/site'
import { contacts, school } from '@/modules/content'
import { listPeople } from '@/modules/people'
import { getShowsData } from '@/modules/shows'

import { personPhotos } from '@/components/people/personPhotos'
import { Gallery } from '@/components/show/Gallery'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { PersonAvatar } from '@/components/ui/PersonAvatar'
import { reveal } from '@/components/ui/reveal'

import styles from './school.module.css'

const description =
  'Взрослая театральная школа «Домашний театр» при модном театре TURDUS: актёрское мастерство, сценическая речь и первая роль в спектакле на профессиональной сцене.'

export const metadata: Metadata = {
  title: 'Актёрская школа',
  description,
  alternates: { canonical: '/school' },
  openGraph: pageOpenGraph('Актёрская школа «Домашний театр»', school.heroPhoto, description),
}

const price = formatRub(school.tariff.priceRub * 100)

/** Запись — сообщение театру в WhatsApp (ссылка со старого сайта), в новой вкладке. */
function SignupLink() {
  return (
    <ButtonLink href={school.signup.href} target="_blank" rel="noopener noreferrer" size="lg">
      {school.signup.label}
      <span className="visually-hidden"> (откроется в новой вкладке)</span>
    </ButtonLink>
  )
}

function Actions() {
  return (
    <div className={styles.actions}>
      <SignupLink />
      <ButtonLink href={contacts.phone.href} variant="outline" size="lg">
        {contacts.phone.display}
      </ButtonLink>
    </div>
  )
}

/**
 * «Курсы»: взрослая театральная школа «Домашний театр». Тексты, тариф, педагоги, отзывы и
 * фото — с teatrturdus.ru/theatre-school и /school (`school` в modules/content). Детские
 * программы и курс речи пока живут на старом сайте — ведём туда.
 */
export default function SchoolPage() {
  const pages = new Set(listPeople(getShowsData()).map((p) => p.slug))
  const facts = [
    { value: school.age, label: 'возраст участников' },
    { value: school.duration[0]!.value, label: 'проектный курс, есть круглогодичный' },
    { value: 'вт и чт', label: 'с 19.00 до 21.00' },
    { value: price, label: `в месяц, тариф «${school.tariff.name}»` },
  ]

  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.hero}>
        <div className={styles.heroText} {...reveal()}>
          <p className={styles.kicker}>
            {school.kicker} <span aria-hidden="true">·</span> {school.age}
          </p>
          <h1 className={styles.title}>{school.title}</h1>
          <p className={styles.lead}>{school.lead}</p>
          <p className={styles.promise}>{school.promise}</p>
          <Actions />
        </div>
        <div className={styles.heroPhoto} {...reveal(1)}>
          <Image
            src={school.heroPhoto}
            alt="Участники «Домашнего театра» на сцене"
            fill
            priority
            sizes="(min-width: 60rem) 40vw, 100vw"
          />
        </div>
      </header>

      <ul className={styles.facts} aria-label="Коротко о курсе">
        {facts.map((fact, i) => (
          <li key={fact.label} className={styles.fact} {...reveal(i)}>
            <b>{fact.value}</b>
            <span>{fact.label}</span>
          </li>
        ))}
      </ul>

      <section className={styles.section} aria-labelledby="program-title">
        <h2 id="program-title" className={styles.sectionTitle} {...reveal()}>
          Программа способствует
        </h2>
        <ol className={styles.program}>
          {school.program.map((item, i) => (
            <li key={item} {...reveal(i % 3)}>
              <span className={styles.num} aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              {item}
            </li>
          ))}
        </ol>
      </section>

      <div className={`${styles.section} ${styles.split}`}>
        <section aria-labelledby="includes-title" {...reveal()}>
          <h2 id="includes-title" className={styles.sectionTitle}>
            Что входит
          </h2>
          <ul className={styles.lines}>
            {school.includes.map((item) => (
              <li key={item.title}>
                <b>{item.title}</b>
                {'note' in item && <span>{item.note}</span>}
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="outcomes-title" {...reveal(1)}>
          <h2 id="outcomes-title" className={styles.sectionTitle}>
            Чему вы научитесь
          </h2>
          <ul className={styles.lines}>
            {school.outcomes.map((item) => (
              <li key={item}>
                <b>{item}</b>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className={`${styles.section} ${styles.tariff}`} aria-labelledby="tariff-title">
        <div className={styles.tariffCard} {...reveal()}>
          <p className={styles.tariffName}>Тариф «{school.tariff.name}»</p>
          <h2 id="tariff-title" className={styles.price}>
            {price}
            <span> / {school.tariff.period}</span>
          </h2>
          <ul className={styles.features}>
            {school.tariff.features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <SignupLink />
        </div>
        <dl className={styles.terms} {...reveal(1)}>
          <div>
            <dt>Длительность</dt>
            <dd>
              {school.duration.map((d) => (
                <span key={d.label}>
                  {d.label} — {d.value}
                </span>
              ))}
            </dd>
          </div>
          <div>
            <dt>Расписание</dt>
            <dd>{school.schedule}</dd>
          </div>
          <div>
            <dt>Вопросы</dt>
            <dd>
              <a href={contacts.phone.href}>{contacts.phone.display}</a>
              <a href={`mailto:${contacts.email}`}>{contacts.email}</a>
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="teachers-title">
        <h2 id="teachers-title" className={styles.sectionTitle} {...reveal()}>
          Педагоги
        </h2>
        <ul className={styles.teachers}>
          {school.teachers.map((t, i) => (
            <li key={t.slug} className={styles.teacher} {...reveal(i)}>
              <PersonAvatar
                name={t.name}
                photo={personPhotos[t.slug]}
                className={styles.portrait}
              />
              <p className={styles.position}>{t.position}</p>
              <h3 className={styles.teacherName}>
                {pages.has(t.slug) ? <Link href={`/people/${t.slug}`}>{t.name}</Link> : t.name}
              </h3>
              {t.bio.map((p) => (
                <p key={p} className={styles.bio}>
                  {p}
                </p>
              ))}
              {'works' in t && t.works && (
                <details className={styles.works}>
                  <summary>Спектакли ({t.works.length})</summary>
                  <ul>
                    {t.works.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="shows-title">
        <h2 id="shows-title" className={styles.sectionTitle} {...reveal()}>
          Поставленные спектакли
        </h2>
        <ul className={styles.shows}>
          {school.shows.map((show, i) => (
            <li key={show.title} className={styles.show} {...reveal(i % 4)}>
              <div className={styles.showPhoto}>
                <Image
                  src={show.photo}
                  alt={`Сцена из спектакля «${show.title}»`}
                  fill
                  sizes="(min-width: 70rem) 15vw, (min-width: 60rem) 25vw, 50vw"
                />
              </div>
              <p className={styles.showTitle}>{show.title}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="rehearsals-title">
        <h2 id="rehearsals-title" className={styles.sectionTitle} {...reveal()}>
          С прогонов и репетиций
        </h2>
        <Gallery
          label="Фото с прогонов и репетиций «Домашнего театра»"
          mobile="masonry"
          items={school.rehearsalPhotos.map((src, i) => ({
            src,
            alt: `Репетиция «Домашнего театра», фото ${i + 1}`,
          }))}
        />
      </section>

      <section className={styles.section} aria-labelledby="reviews-title">
        <h2 id="reviews-title" className={styles.sectionTitle} {...reveal()}>
          Отзывы участников и зрителей
        </h2>
        <ul className={styles.reviews}>
          {school.reviews.map((r) => (
            <li key={r.author} className={styles.review}>
              <blockquote>
                {r.text.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </blockquote>
              <p className={styles.author}>{r.author}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="programs-title">
        <h2 id="programs-title" className={styles.sectionTitle} {...reveal()}>
          Другие программы
        </h2>
        <ul className={styles.programs}>
          {school.otherPrograms.map((p, i) => (
            <li key={p.href} {...reveal(i)}>
              <a href={p.href} target="_blank" rel="noopener noreferrer">
                <span className={styles.audience}>{p.audience}</span>
                <b>{p.title}</b>
                <span className={styles.programText}>{p.text}</span>
                <span className={styles.more}>
                  Подробнее на сайте театра
                  <span className="visually-hidden"> (откроется в новой вкладке)</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.final} aria-labelledby="final-title" {...reveal()}>
        <h2 id="final-title" className={styles.finalTitle}>
          {school.promise}
        </h2>
        <Actions />
      </section>
    </div>
  )
}
