import Image from 'next/image'

import styles from './Gallery.module.css'

/**
 * Фото спектакля масонри-сеткой (CSS columns). Фото одного спектакля обычно в
 * одной пропорции, поэтому ритм задают плитки разной высоты (4:5, 3:2, 1:1, 4:3);
 * фото заполняет плитку (object-fit: cover). Высота плитки известна до загрузки —
 * сетка не прыгает.
 */
export function Gallery({ photos, title }: { photos: string[]; title: string }) {
  return (
    <ul className={styles.masonry} aria-label={`Фото спектакля «${title}»`}>
      {photos.map((src, i) => (
        <li key={src} className={styles.tile}>
          <Image
            src={src}
            alt={`Сцена из спектакля «${title}», фото ${i + 1}`}
            fill
            sizes="(min-width: 80rem) 25vw, (min-width: 60rem) 33vw, 50vw"
          />
        </li>
      ))}
    </ul>
  )
}
