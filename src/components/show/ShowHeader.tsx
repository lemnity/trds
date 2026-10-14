import Image from 'next/image'
import Link from 'next/link'

import { formatRub } from '@/lib/money'
import { formatAge, formatPerformanceDate, type SalePerformance, type Show } from '@/modules/shows'

import buttons from '../ui/button.module.css'
import styles from './ShowHeader.module.css'

export const CalendarIcon = () => (
  <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
    <rect
      x="3"
      y="4.5"
      width="14"
      height="12"
      rx="2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M3 8.5h14M7 3v3M13 3v3"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
)

export const PinIcon = () => (
  <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
    <path
      d="M10 17.5s5.5-5 5.5-9.25a5.5 5.5 0 0 0-11 0C4.5 12.5 10 17.5 10 17.5Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <circle cx="10" cy="8.25" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

export const datesWord = (n: number) =>
  n % 10 === 1 && n % 100 !== 11
    ? 'дата'
    : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)
      ? 'даты'
      : 'дат'

/** Минимальная цена среди показов с открытой продажей; null — на сайте продажи нет. */
export const minPrice = (performances: SalePerformance[]) => {
  let min: { kopecks: number; placeholder: boolean } | null = null
  for (const p of performances) {
    if (!p.salesOpen || p.minPriceKopecks === null) continue
    if (!min || p.minPriceKopecks < min.kopecks)
      min = { kopecks: p.minPriceKopecks, placeholder: p.pricePlaceholder }
  }
  return min
}

/** С такой длины название набирается кеглем меньше, чтобы уложиться в 1–2 строки. */
export const LONG_TITLE = 24

type Props = { show: Show; performances: SalePerformance[] }

export function ShowHeader({ show, performances }: Props) {
  const next = performances[0]
  // Фото со спектакля кадрируем; афишу показываем целиком — на ней текст, обрезать нельзя.
  const photo = show.gallery[0]
  const date = next ? formatPerformanceDate(next.startsAt) : null
  const price = minPrice(performances)
  const more = performances.length - 1
  const eyebrow = [show.genre, formatAge(show.ageLimit)].filter((c): c is string => c !== null)

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

      <header className={styles.hero}>
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

        <div className={styles.content}>
          <div className={styles.intro}>
            {eyebrow.length > 0 && <p className={styles.eyebrow}>{eyebrow.join(' · ')}</p>}
            <h1 className={styles.title} data-long={show.title.length > LONG_TITLE || undefined}>
              {show.title}
            </h1>
          </div>

          <p className={styles.lead}>{show.lead}</p>

          <div className={styles.session}>
            {next && date ? (
              <>
                <dl className={styles.meta}>
                  <div>
                    <dt>
                      <CalendarIcon />
                      <span className="visually-hidden">Ближайший показ</span>
                    </dt>
                    <dd>
                      {date.longDate}, {date.weekday} в {date.time}
                      {more > 0 && (
                        <span className={styles.more}>
                          и ещё {more} {datesWord(more)}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <PinIcon />
                      <span className="visually-hidden">Площадка</span>
                    </dt>
                    <dd>{next.venue.title}</dd>
                  </div>
                </dl>

                <div className={styles.actions}>
                  <a href="#tickets" className={buttons.button}>
                    Выбрать билеты <span aria-hidden="true">→</span>
                  </a>
                  {price && (
                    <p className={styles.price}>
                      от <strong>{formatRub(price.kopecks)}</strong>
                      {price.placeholder && <span> · цена предварительная</span>}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className={styles.noDates}>Ближайших показов пока нет, даты появятся позже.</p>
            )}
          </div>
        </div>
      </header>
    </div>
  )
}
