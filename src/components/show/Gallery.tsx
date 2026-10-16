import Image from 'next/image'

import { reveal } from '@/components/ui/reveal'
import styles from './Gallery.module.css'

export type GalleryItem = { src: string; alt: string; caption?: string }

type Props = {
  /** Подпись списка для экранного диктора. */
  label: string
  items: GalleryItem[]
  /** Телефон: лента вбок (по умолчанию) или та же масонри-сетка в две колонки. */
  mobile?: 'strip' | 'masonry'
}

/**
 * Фото масонри-сеткой (CSS columns). Фото одного спектакля обычно в одной пропорции,
 * поэтому ритм задают плитки разной высоты (4:5, 3:2, 1:1, 4:3); фото заполняет плитку
 * (object-fit: cover). Высота плитки известна до загрузки — сетка не прыгает.
 */
export function Gallery({ label, items, mobile = 'strip' }: Props) {
  return (
    <ul className={styles.masonry} data-mobile={mobile} aria-label={label}>
      {items.map((item, i) => (
        <li key={item.src} className={styles.tile} {...reveal(i % 4)}>
          <Image
            src={item.src}
            alt={item.alt}
            fill
            sizes="(min-width: 80rem) 25vw, (min-width: 60rem) 33vw, 50vw"
          />
          {item.caption && <span className={styles.caption}>{item.caption}</span>}
        </li>
      ))}
    </ul>
  )
}

/** Фото одного спектакля: подпись «Сцена из спектакля …, фото N». */
export const showGalleryItems = (photos: string[], title: string): GalleryItem[] =>
  photos.map((src, i) => ({ src, alt: `Сцена из спектакля «${title}», фото ${i + 1}` }))
