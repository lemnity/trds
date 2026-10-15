import Image from 'next/image'

import { formatRub } from '@/lib/money'
import { type SalePerformance, type Show } from '@/modules/shows'

import { minPrice } from './showHeaderParts'
import styles from './ShowHeaderCompact.module.css'
import { buttonVariants } from '@heroui/styles'
import { TicketIcon } from '../ui/TicketIcon'

/** Обложка на всю ширину (название и крошки — в ShowHero над ней). */
export function ShowCover({ show }: { show: Show }) {
  const photo = show.gallery[0]
  return (
    <div className="container">
      <div className={styles.media} data-kind={photo ? 'photo' : 'poster'}>
        {photo ? (
          <Image src={photo} alt="" fill priority sizes="100vw" />
        ) : (
          <>
            <Image src={show.posterUrl} alt="" fill sizes="30vw" className={styles.backdrop} />
            <Image
              src={show.posterUrl}
              alt={`Афиша спектакля «${show.title}»`}
              fill
              priority
              sizes="(min-width: 60rem) 50vw, 100vw"
              className={styles.poster}
            />
          </>
        )}
      </div>
    </div>
  )
}

/** Цена «от» и кнопка покупки — под карточкой «О спектакле» в правой колонке. */
export function ShowBuy({ performances }: { performances: SalePerformance[] }) {
  const price = minPrice(performances)
  if (!performances[0]) return null
  return (
    <div className={styles.buyBox}>
      {price && (
        <p className={styles.price}>
          от <strong>{formatRub(price.kopecks)}</strong>
          {price.placeholder && <span className={styles.note}> · предварительно</span>}
        </p>
      )}
      <a href="#tickets" className={buttonVariants({ fullWidth: true })}>
        <TicketIcon /> Купить билет
      </a>
    </div>
  )
}
