import type { Metadata } from 'next'

import { CorporateForm } from '@/components/corporate/CorporateForm'
import { Gallery } from '@/components/show/Gallery'
import { reveal } from '@/components/ui/reveal'
import { contacts, corporate } from '@/modules/content'

import styles from './corporate.module.css'

export const metadata: Metadata = {
  title: 'Корпоративы',
  description:
    'Спектакль или иммерсивный перформанс модного театра TURDUS для корпоратива, презентации, дня рождения или частного события.',
  alternates: { canonical: '/corporate' },
}

/**
 * Корпоративы: тексты и ссылки с сайта театра, форма заявки (T-034), фото с прошедших событий.
 * Заявка уходит в `POST /api/leads`; на статическом превью — письмом театру (CorporateForm).
 */
export default function CorporatePage() {
  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.head} {...reveal()}>
        <p className={styles.kicker}>{corporate.title}</p>
        <h1 className={styles.title}>{corporate.slogan}</h1>
      </header>

      <div className={styles.layout}>
        <div className={styles.intro} {...reveal(1)}>
          {corporate.paragraphs.map((text) => (
            <p key={text}>{text}</p>
          ))}
          <ul className={styles.links}>
            <li>
              <a href={corporate.presentationUrl} target="_blank" rel="noopener noreferrer">
                <b>Презентация и цены</b>
                <span>Файл театра на Google Диске</span>
              </a>
            </li>
            <li>
              <a href={corporate.manager.href} target="_blank" rel="noopener noreferrer">
                <b>{corporate.manager.label}</b>
                <span>Telegram {corporate.manager.handle}</span>
              </a>
            </li>
            <li>
              <a href={contacts.phone.href}>
                <b>{contacts.phone.display}</b>
                <span>{contacts.office.hours}</span>
              </a>
            </li>
          </ul>
        </div>

        <section className={styles.formCard} aria-labelledby="lead-title" {...reveal(2)}>
          <h2 id="lead-title" className={styles.formTitle}>
            Оставить заявку
          </h2>
          <p className={styles.formLead}>Ответим и предложим спектакль под ваш повод.</p>
          <CorporateForm email={contacts.email} manager={corporate.manager} />
        </section>
      </div>

      <section className={styles.photos} aria-labelledby="corp-photos-title">
        <h2 id="corp-photos-title" className={styles.photosTitle} {...reveal()}>
          Как это было
        </h2>
        <Gallery
          label="Фото с корпоративных событий театра"
          mobile="masonry"
          items={corporate.photos.map((src, i) => ({
            src,
            alt: `Спектакль модного театра TURDUS на корпоративном событии, фото ${i + 1}`,
          }))}
        />
      </section>
    </div>
  )
}
