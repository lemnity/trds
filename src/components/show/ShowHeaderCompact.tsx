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

      <header className={styles.head}>
        <h1 className={styles.title}>{show.title}</h1>

        <div className={styles.row}>
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
          {price && (
            <p className={styles.price}>
              от <strong>{formatRub(price.kopecks)}</strong>
              {price.placeholder && <span className={styles.note}> · предварительно</span>}
            </p>
          )}
        </div>

        <div className={styles.row}>
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
          {next && (
            <a href="#tickets" className={buttonVariants({ size: 'lg', className: styles.buy })}>
              <TicketIcon /> Купить билет
            </a>
          )}
        </div>
      </header>
    </div>
  )
}
