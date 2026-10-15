'use client'

import { Button } from '@heroui/react'
import Image from 'next/image'
import { useState, type CSSProperties } from 'react'

import styles from './PhotoMarquee.module.css'

export type MarqueePhoto = { src: string; alt: string }

/** Секунд на один кадр: лента идёт спокойно. */
const SECONDS_PER_PHOTO = 6

/**
 * Бесконечная лента фото: список выводится дважды и сдвигается на половину ширины —
 * шва нет; вторая копия скрыта от дикторов и клавиатуры. WCAG 2.2.2: кнопка «Пауза»,
 * остановка при наведении и фокусе; при reduced motion и в версии для слабовидящих —
 * без движения, обычная прокрутка.
 */
export function PhotoMarquee({ photos }: { photos: MarqueePhoto[] }) {
  const [paused, setPaused] = useState(false)
  const duration = {
    '--marquee-duration': `${photos.length * SECONDS_PER_PHOTO}s`,
  } as CSSProperties

  const list = (copy: boolean) => (
    <ul className={styles.list} aria-hidden={copy || undefined} inert={copy || undefined}>
      {photos.map((photo, i) => (
        <li key={photo.src} className={styles.tile} data-wide={i % 3 === 0 || undefined}>
          <Image src={photo.src} alt={copy ? '' : photo.alt} fill sizes="30rem" />
        </li>
      ))}
    </ul>
  )

  return (
    <div className={styles.marquee} data-paused={paused || undefined}>
      <div className={styles.viewport}>
        <div className={styles.track} style={duration}>
          {list(false)}
          {list(true)}
        </div>
      </div>
      <Button variant="outline" className={styles.toggle} onPress={() => setPaused(!paused)}>
        {paused ? 'Продолжить' : 'Пауза'}
      </Button>
    </div>
  )
}
