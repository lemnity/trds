import type { Metadata } from 'next'
import Image from 'next/image'

import { ButtonLink } from '@/components/ui/ButtonLink'
import { aboutTheatre, partners } from '@/modules/content'

import head from '../page-head.module.css'
import styles from './about.module.css'

export const metadata: Metadata = {
  title: 'О театре',
  description: 'Модный театр TURDUS: спектакли на неординарных площадках Екатеринбурга.',
}

export default function AboutPage() {
  return (
    <div className="container">
      <header className={head.head}>
        <h1 className={head.title}>{aboutTheatre.title}</h1>
        <p className={head.lead}>{aboutTheatre.lead}</p>
      </header>

      <div className={styles.layout}>
        <div className={styles.prose}>
          {aboutTheatre.paragraphs.map((p, i) => (
            // Список статичен и не переупорядочивается.
            <p key={i}>{p}</p>
          ))}
          <ButtonLink href="/afisha">Смотреть афишу</ButtonLink>
        </div>
        <div className={styles.photos}>
          {aboutTheatre.photos.map((src) => (
            <div key={src} className={styles.photo}>
              <Image
                src={src}
                alt="Команда модного театра TURDUS"
                fill
                sizes="(min-width: 60rem) 20vw, 33vw"
              />
            </div>
          ))}
        </div>
      </div>

      <section className={styles.section} aria-labelledby="partners-title">
        <h2 id="partners-title" className={styles.title}>
          Партнёры и площадки
        </h2>
        <ul className={styles.partners}>
          {partners.map((p) => (
            <li key={p.name}>
              <span className={styles.partnerName}>{p.name}</span>
              <span className={styles.partnerRole}>{p.role}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
