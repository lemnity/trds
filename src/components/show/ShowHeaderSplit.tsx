import Image from 'next/image'
import Link from 'next/link'

import { formatRub } from '@/lib/money'
import { formatAge, formatPerformanceDate, type SalePerformance, type Show } from '@/modules/shows'

import buttons from '../ui/button.module.css'
import { datesWord, LONG_TITLE, minPrice } from './ShowHeader'
import styles from './ShowHeaderSplit.module.css'

/** Сколько ближайших показов перечислить на первом экране; остальные — в блоке покупки. */
const HERO_DATES = 3

type Props = { show: Show; performances: SalePerformance[] }

/**
 * Вариант Б первого экрана — «афишный разворот»: вертикальная обложка слева,
 * справа информация и ближайшие даты строками, по которым сразу переходят к покупке.
 */
export function ShowHeaderSplit({ show, performances }: Props) {
  const photo = show.gallery[0]
  const price = minPrice(performances)
  const shown = performances.slice(0, HERO_DATES)
  const rest = performances.length - shown.length
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
            <Image src={photo} alt="" fill priority sizes="(min-width: 60rem) 40vw, 100vw" />
          ) : (
            <>
              <Image src={show.posterUrl} alt="" fill sizes="30vw" className={styles.backdrop} />
              <Image
                src={show.posterUrl}
                alt={`Афиша спектакля «${show.title}»`}
                fill
                priority
                sizes="(min-width: 60rem) 40vw, 100vw"
                className={styles.poster}
              />
            </>
          )}
        </div>

        <div className={styles.info}>
          {eyebrow.length > 0 && <p className={styles.eyebrow}>{eyebrow.join(' · ')}</p>}
          <h1 className={styles.title} data-long={show.title.length > LONG_TITLE || undefined}>
            {show.title}
          </h1>
          <p className={styles.lead}>{show.lead}</p>

          {shown.length > 0 ? (
            <div className={styles.dates}>
              <h2 className={styles.datesTitle}>Ближайшие показы</h2>
              <ul>
                {shown.map((p) => {
                  const d = formatPerformanceDate(p.startsAt)
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/shows/${show.slug}?date=${p.id}#tickets`}
                        className={styles.date}
                      >
                        <span className={styles.day}>
                          <span className={styles.dayNum}>{d.day}</span>
                          <span className={styles.dayMonth}>{d.month}</span>
                        </span>
                        <span className={styles.when}>
                          <span className={styles.whenMain}>
                            {d.weekday}, {d.time}
                          </span>
                          <span className={styles.venue}>{p.venue.title}</span>
                        </span>
                        <span className={styles.status} data-open={p.salesOpen}>
                          {p.salesOpen ? 'Билеты есть' : 'Продажа не открыта'}
                        </span>
                        <span className={styles.arrow} aria-hidden="true">
                          →
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
              {rest > 0 && (
                <p className={styles.rest}>
                  И ещё {rest} {datesWord(rest)} в блоке покупки
                </p>
              )}

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
            </div>
          ) : (
            <p className={styles.noDates}>Ближайших показов пока нет, даты появятся позже.</p>
          )}
        </div>
      </header>
    </div>
  )
}
