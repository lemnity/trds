import Image from 'next/image'
import Link from 'next/link'

import { formatRub } from '@/lib/money'
import {
  formatAge,
  formatDuration,
  formatPerformanceDate,
  type SalePerformance,
  type Show,
} from '@/modules/shows'

import buttons from '../ui/button.module.css'
import { CalendarIcon, minPrice, PinIcon } from './ShowHeader'
import styles from './ShowHeaderCompact.module.css'

type Props = { show: Show; performances: SalePerformance[] }

/**
 * Вариант В первого экрана (референс заказчика): обложка на всю ширину; под ней
 * название, плашки «жанр · возраст · длительность» с ценой справа, плашки
 * «дата · площадка» с кнопкой покупки справа.
 */
export function ShowHeaderCompact({ show, performances }: Props) {
  const photo = show.gallery[0]
  const next = performances[0]
  const date = next ? formatPerformanceDate(next.startsAt) : null
  const price = minPrice(performances)
  const chips = [show.genre, formatAge(show.ageLimit), formatDuration(show.durationMinutes)].filter(
    (c): c is string => c !== null,
  )

  return (
    <div className="container">
      <nav aria-label="Хлебные крошки" className={styles.crumbs}>
        <ol>
          <li>
            <Link href="/">Главная</Link>
          </li>
          <li>
            <Link href="/afisha">Афиша</Link>
          </li>
          <li aria-current="page">{show.title}</li>
        </ol>
      </nav>

      <div className={styles.media} data-kind={photo ? 'photo' : 'poster'}>
        {photo ? (
          <Image src={photo} alt="" fill priority sizes="(min-width: 82rem) 82rem, 100vw" />
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

      <header className={styles.head}>
        <h1 className={styles.title}>{show.title}</h1>

        <div className={styles.row}>
          {chips.length > 0 && (
            <ul className={styles.chips} aria-label="Жанр, возраст и длительность">
              {chips.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          {price && (
            <p className={styles.price}>
              от <strong>{formatRub(price.kopecks)}</strong>
              {price.placeholder && <span className={styles.note}> · предварительно</span>}
            </p>
          )}
        </div>

        <div className={styles.row}>
          {next && date ? (
            <ul className={styles.chips} aria-label="Ближайший показ">
              <li className={styles.iconChip}>
                <CalendarIcon />
                {date.longDate}, {date.time}
              </li>
              <li className={styles.iconChip}>
                <PinIcon />
                {next.venue.title}
              </li>
            </ul>
          ) : (
            <p className={styles.note}>Ближайших показов пока нет, даты появятся позже.</p>
          )}
          {next && (
            <a href="#tickets" className={`${buttons.button} ${styles.buy}`}>
              Купить билет <span aria-hidden="true">→</span>
            </a>
          )}
        </div>
      </header>
    </div>
  )
}
