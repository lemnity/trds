import type { Metadata } from 'next'
import Link from 'next/link'

import { SocialIcon } from '@/components/site/SocialIcon'
import { reveal } from '@/components/ui/reveal'
import { contacts, mailTo } from '@/modules/content'

import styles from './contacts.module.css'

export const metadata: Metadata = {
  alternates: { canonical: '/contacts' },
  title: 'Контакты',
  description: `Модный театр TURDUS: ${contacts.phone.display}, ${contacts.email}, ${contacts.office.short}.`,
}

const Arrow = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className={styles.arrow}>
    <path
      d="M5 12h14M13 6l6 6-6 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** По какому вопросу: куда идти или о чём написать (тема письма подставляется). */
const TOPICS = [
  {
    title: 'Купить билеты',
    text: 'Даты, площадки и билеты — в афише.',
    href: '/afisha',
  },
  {
    title: 'Заказать спектакль',
    text: 'Корпоратив, день рождения, частное событие.',
    href: mailTo('Корпоратив'),
  },
  {
    title: 'Оставить отзыв',
    text: 'Расскажите, как прошёл вечер.',
    href: mailTo('Отзыв о театре TURDUS'),
  },
  {
    title: 'Партнёрство и пресса',
    text: 'Площадки, коллаборации, публикации.',
    href: mailTo('Партнёрство'),
  },
]

/**
 * Контакты: телефон и почта крупно, офис (адрес, часы, карта), соцсети и «по какому вопросу».
 * Данные — modules/content `contacts` (общие с подвалом). Карту не встраиваем — ссылка.
 */
export default function ContactsPage() {
  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.head} {...reveal()}>
        <p className={styles.kicker}>Модный театр TURDUS</p>
        <h1 className={styles.title}>Контакты</h1>
      </header>

      <section className={styles.main} aria-label="Связаться с театром">
        <div className={styles.direct}>
          <a href={contacts.phone.href} className={styles.huge} {...reveal(1)}>
            <span className={styles.label}>Позвонить</span>
            {contacts.phone.display}
          </a>
          <a href={`mailto:${contacts.email}`} className={styles.huge} {...reveal(2)}>
            <span className={styles.label}>Написать</span>
            {contacts.email}
          </a>
          <ul className={styles.social} aria-label="Соцсети" {...reveal(3)}>
            {contacts.social.map((s) => (
              <li key={s.name}>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.socialLink}
                >
                  <SocialIcon name={s.name} />
                  <span>
                    <b>{s.name}</b>
                    <span className={styles.handle}>{s.handle}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>

        <address className={styles.office} {...reveal(2)}>
          <p className={styles.officeLabel}>Офис театра</p>
          <p className={styles.officeAddress}>{contacts.office.short}</p>
          <p className={styles.officeHours}>{contacts.office.hours}</p>
          <a
            href={contacts.office.mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.mapLink}
          >
            Открыть на Яндекс Картах <Arrow />
          </a>
          <p className={styles.officeNote}>
            Спектакли идут не в офисе, а на <Link href="/venues">площадках города</Link> — адрес
            указан в каждом показе.
          </p>
        </address>
      </section>

      <section className={styles.topicsWrap} aria-labelledby="topics-title">
        <h2 id="topics-title" className={styles.topicsTitle} {...reveal()}>
          По какому вопросу?
        </h2>
        <ul className={styles.topics}>
          {TOPICS.map((topic, i) => (
            <li key={topic.title} {...reveal(i)}>
              {topic.href.startsWith('/') ? (
                <Link href={topic.href} className={styles.topic}>
                  <span className={styles.topicTitle}>{topic.title}</span>
                  <span className={styles.topicText}>{topic.text}</span>
                  <Arrow />
                </Link>
              ) : (
                <a href={topic.href} className={styles.topic}>
                  <span className={styles.topicTitle}>{topic.title}</span>
                  <span className={styles.topicText}>{topic.text}</span>
                  <Arrow />
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
