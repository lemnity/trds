import Image from 'next/image'

import { formatRub } from '@/lib/money'
import {
  formatAge,
  formatDuration,
  formatPerformanceDate,
  type SalePerformance,
  type Show,
} from '@/modules/shows'

import { CalendarIcon, minPrice, PinIcon } from './showHeaderParts'
import { PremiereBadge } from '../ui/PremiereBadge'
import styles from './ShowHeaderCompact.module.css'
import { buttonVariants } from '@heroui/styles'
import { TicketIcon } from '../ui/TicketIcon'
import { Chip } from '@heroui/react'
import { PageCrumbs } from '../ui/PageCrumbs'

type Props = { show: Show; performances: SalePerformance[] }

/** Обложка на всю ширину и хлебные крошки под ней. */
export function ShowCover({ show }: { show: Show }) {
  const photo = show.gallery[0]
  return (
    <div className="container">
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

      <PageCrumbs
        className={styles.crumbs}
        items={[
          { label: 'Главная', href: '/' },
          { label: 'Афиша', href: '/afisha' },
          { label: show.title },
        ]}
      />
    </div>
  )
}

/** Название и плашки: «жанр · возраст · длительность», затем «дата · площадка». */
export function ShowTitle({ show, performances }: Props) {
  const next = performances[0]
  const date = next ? formatPerformanceDate(next.startsAt) : null
  const chips = [show.genre, formatAge(show.ageLimit), formatDuration(show.durationMinutes)].filter(
    (c): c is string => c !== null,
  )

  return (
    <header className={styles.head}>
      <h1 className={styles.title}>{show.title}</h1>

      {(chips.length > 0 || show.premiere) && (
        <div className={styles.chips} aria-label="Жанр, возраст и длительность" role="group">
          {show.premiere && <PremiereBadge />}
          {chips.map((c) => (
            <Chip key={c} size="lg" variant="soft">
              {c}
            </Chip>
          ))}
        </div>
      )}

      {next && date ? (
        <div className={styles.chips} aria-label="Ближайший показ" role="group">
          <Chip size="lg" variant="secondary">
            <CalendarIcon />
            <Chip.Label>
              {date.longDate}, {date.time}
            </Chip.Label>
          </Chip>
          <Chip size="lg" variant="secondary">
            <PinIcon />
            <Chip.Label>{next.venue.title}</Chip.Label>
          </Chip>
        </div>
      ) : (
        <p className={styles.note}>Ближайших показов пока нет, даты появятся позже.</p>
      )}
    </header>
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
      <a href="#tickets" className={buttonVariants({ size: 'lg', fullWidth: true })}>
        <TicketIcon /> Купить билет
      </a>
    </div>
  )
}
