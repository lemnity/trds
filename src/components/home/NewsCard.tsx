import { Chip } from '@heroui/react'
import Image from 'next/image'
import Link from 'next/link'

import type { NewsItem } from '@/modules/content'

import { cardClass } from '../ui/card'
import styles from './NewsCard.module.css'

/** Карточка новости — вся карточка ссылка (на главной и в архиве). */
export function NewsCard({ item }: { item: NewsItem }) {
  return (
    <article className={cardClass(styles.card)}>
      <div className={styles.media}>
        <Image src={item.imageUrl} alt="" fill sizes="(min-width: 60rem) 25vw, 100vw" />
      </div>
      <div className={styles.body}>
        <Chip size="sm" variant="soft" className={styles.tag}>
          {item.tag}
        </Chip>
        <h3 className={styles.title}>
          <Link href={item.href}>{item.title}</Link>
        </h3>
        <p className={styles.summary}>{item.summary}</p>
      </div>
    </article>
  )
}

/** Сетка новостей: не больше 4 в ряд. */
export function NewsList({ items }: { items: NewsItem[] }) {
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item.id}>
          <NewsCard item={item} />
        </li>
      ))}
    </ul>
  )
}
