import Image from 'next/image'
import Link from 'next/link'

import type { PersonArchiveShow, PersonShow } from '@/modules/people'
import { formatPerformanceDate } from '@/modules/shows'

import { ButtonLink } from '../ui/ButtonLink'
import { TicketIcon } from '../ui/TicketIcon'
import styles from './RolesLab.module.css'

type Props = { name: string; shows: PersonShow[]; archive: PersonArchiveShow[] }

const when = (s: PersonShow) => {
  if (!s.next) return null
  const d = formatPerformanceDate(s.next.startsAt)
  return { ...d, venue: s.next.venueTitle, href: `/shows/${s.slug}?date=${s.next.id}#tickets` }
}

/** Фото для вертикального кадра: снимок спектакля, иначе обложка. */
const Photo = ({ s, sizes }: { s: PersonShow; sizes: string }) =>
  s.photoUrl ? (
    <Image src={s.photoUrl} alt="" fill sizes={sizes} className={styles.cover} />
  ) : (
    <>
      <Image src={s.posterUrl} alt="" fill sizes="10vw" className={styles.blur} />
      <Image src={s.posterUrl} alt="" fill sizes={sizes} className={styles.contain} />
    </>
  )

const pad = (n: number) => String(n).padStart(2, '0')

const roleText = (s: Pick<PersonShow, 'roles'>) => s.roles.map((r) => r.title).join(', ')
const hasCharacter = (s: Pick<PersonShow, 'roles'>) => s.roles.some((r) => r.kind === 'character')

/** А — «Программка»: строки как в театральной программке, роль крупно. */
function Programme({ shows }: Props) {
  return (
    <ol className={styles.prog}>
      {shows.map((s, i) => {
        const w = when(s)
        return (
          <li key={s.slug} className={styles.progRow}>
            <span className={styles.progNum}>{pad(i + 1)}</span>
            <Link href={`/shows/${s.slug}`} className={styles.progThumb} tabIndex={-1}>
              <Photo s={s} sizes="8rem" />
            </Link>
            <div className={styles.progMain}>
              <p className={styles.kicker}>{hasCharacter(s) ? 'в роли' : 'в спектакле'}</p>
              <p className={styles.progRole}>{roleText(s)}</p>
              <p className={styles.progShow}>
                <Link href={`/shows/${s.slug}`}>{s.title}</Link>
                {s.genre && <span> · {s.genre}</span>}
              </p>
            </div>
            <div className={styles.progNext}>
              {w ? (
                <>
                  <p>
                    <b>
                      {w.day} {w.month}
                    </b>
                    , {w.weekday} · {w.time}
                    <br />
                    {w.venue}
                  </p>
                  <ButtonLink href={w.href}>
                    <TicketIcon /> Билеты
                  </ButtonLink>
                </>
              ) : (
                <p className={styles.muted}>Ближайших показов нет</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Б — «Кулисы»: лента высоких карточек вбок, имя роли во весь низ кадра. */
function Strip({ shows }: Props) {
  return (
    <ul className={styles.strip}>
      {shows.map((s) => {
        const w = when(s)
        return (
          <li key={s.slug} className={styles.stripCard}>
            <div className={styles.stripMedia}>
              <Photo s={s} sizes="20rem" />
              <div className={styles.stripCap}>
                <p className={styles.kickerLight}>{s.title}</p>
                <p className={styles.stripRole}>{roleText(s)}</p>
              </div>
              <Link href={`/shows/${s.slug}`} className={styles.stretch} aria-label={s.title} />
            </div>
            <div className={styles.stripNext}>
              {w ? (
                <>
                  <span>
                    {w.day} {w.month} · {w.time}
                  </span>
                  <Link href={w.href} className={styles.stripLink}>
                    Билеты →
                  </Link>
                </>
              ) : (
                <span className={styles.muted}>Ближайших показов нет</span>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** В — «Афиша роли»: роль огромным шрифтом наезжает на кадр, дата — штампом в углу. */
function Billboard({ shows }: Props) {
  return (
    <ul className={styles.bill}>
      {shows.map((s) => {
        const w = when(s)
        return (
          <li key={s.slug} className={styles.billCard}>
            <div className={styles.billMedia}>
              <Photo s={s} sizes="(min-width: 64rem) 25vw, 50vw" />
              {w && (
                <span className={styles.billStamp}>
                  <b>{w.day}</b>
                  {w.month}
                </span>
              )}
            </div>
            <p className={styles.billRole}>{roleText(s)}</p>
            <p className={styles.billShow}>
              <Link href={`/shows/${s.slug}`} className={styles.billLink}>
                {s.title}
              </Link>
            </p>
            <p className={styles.billMeta}>
              {w ? `${w.weekday}, ${w.time} · ${w.venue}` : 'Ближайших показов нет'}
            </p>
          </li>
        )
      })}
    </ul>
  )
}

/** Г — «Табло»: тёмное табло как в фойе; архив внизу приглушён. */
function Board({ shows, archive }: Props) {
  return (
    <div className={styles.board}>
      <div className={`${styles.boardRow} ${styles.boardHead}`} aria-hidden="true">
        <span>Дата</span>
        <span>Спектакль</span>
        <span>Роль</span>
        <span>Площадка</span>
        <span />
      </div>
      <ul>
        {shows.map((s) => {
          const w = when(s)
          return (
            <li key={s.slug} className={styles.boardRow}>
              <span className={styles.boardDate}>
                {w ? `${w.day} ${w.month}` : '—'}
                {w && <small>{w.time}</small>}
              </span>
              <Link href={`/shows/${s.slug}`} className={styles.boardShow}>
                {s.title}
              </Link>
              <span className={styles.boardRole}>{roleText(s)}</span>
              <span className={styles.boardVenue}>{w?.venue ?? 'Даты появятся позже'}</span>
              {w ? (
                <Link href={w.href} className={styles.boardCta}>
                  Билеты
                </Link>
              ) : (
                <span className={styles.boardStatus}>Ждём даты</span>
              )}
            </li>
          )
        })}
        {archive.map((s) => (
          <li key={s.slug} className={`${styles.boardRow} ${styles.boardPast}`}>
            <span className={styles.boardDate}>архив</span>
            <span className={styles.boardShow}>{s.title}</span>
            <span className={styles.boardRole}>{roleText(s)}</span>
            <span className={styles.boardVenue}>{s.genre ?? ''}</span>
            <span className={styles.boardStatus}>Сыграно</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Д — «Портрет»: слева большой кадр, справа список; наведение на роль меняет кадр. */
function Portrait({ shows, archive }: Props) {
  return (
    <div className={styles.port}>
      <ol className={styles.portList}>
        {shows.map((s, i) => {
          const w = when(s)
          return (
            <li key={s.slug} className={styles.portItem}>
              <div className={styles.portImg}>
                <Photo s={s} sizes="40vw" />
              </div>
              <span className={styles.portNum}>{pad(i + 1)}</span>
              <div className={styles.portText}>
                <p className={styles.portRole}>{roleText(s)}</p>
                <p className={styles.portShow}>
                  <Link href={`/shows/${s.slug}`}>{s.title}</Link>
                </p>
              </div>
              <span className={styles.portWhen}>
                {w ? `${w.day} ${w.month}, ${w.time}` : 'Без дат'}
              </span>
            </li>
          )
        })}
      </ol>
      {archive.length > 0 && (
        <p className={styles.portArchive}>
          <span className={styles.kicker}>Архив</span>{' '}
          {archive.map((a) => `${a.title} — ${roleText(a)}`).join(' · ')}
        </p>
      )}
    </div>
  )
}

/** Е — «Плакаты»: типографика без фото, персонаж огромным шрифтом; архив — контуром. */
function Posters({ shows, archive }: Props) {
  const tones = [styles.toneInk, styles.toneBrand, styles.toneRed]
  return (
    <ul className={styles.posters}>
      {shows.map((s, i) => {
        const w = when(s)
        return (
          <li key={s.slug} className={`${styles.poster} ${tones[i % tones.length]}`}>
            <p className={styles.posterTop}>
              <span>{hasCharacter(s) ? 'в роли' : 'в спектакле'}</span>
              <span>{w ? `${w.day} ${w.month}` : 'скоро'}</span>
            </p>
            <p className={styles.posterRole}>{roleText(s)}</p>
            <p className={styles.posterShow}>
              <Link href={`/shows/${s.slug}`} className={styles.posterLink}>
                «{s.title}»
              </Link>
            </p>
          </li>
        )
      })}
      {archive.map((s) => (
        <li key={s.slug} className={`${styles.poster} ${styles.tonePast}`}>
          <p className={styles.posterTop}>
            <span>архив</span>
            <span>сыграно</span>
          </p>
          <p className={styles.posterRole}>{roleText(s)}</p>
          <p className={styles.posterShow}>«{s.title}»</p>
        </li>
      ))}
    </ul>
  )
}

/** Ж — «Хронология»: лента времени — ближайшие показы сверху, ниже архив. */
function Timeline({ shows, archive }: Props) {
  const dated = [...shows].sort(
    (a, b) =>
      (a.next ? Date.parse(a.next.startsAt) : Infinity) -
      (b.next ? Date.parse(b.next.startsAt) : Infinity),
  )
  return (
    <ol className={styles.tl}>
      <li className={styles.tlGroup}>Сейчас в репертуаре</li>
      {dated.map((s) => {
        const w = when(s)
        return (
          <li key={s.slug} className={styles.tlItem}>
            <span className={styles.tlWhen}>
              {w ? (
                <>
                  <b>{w.day}</b> {w.month}
                </>
              ) : (
                'без дат'
              )}
            </span>
            <span className={styles.tlDot} aria-hidden="true" />
            <div className={styles.tlBody}>
              <div className={styles.tlThumb}>
                <Photo s={s} sizes="6rem" />
              </div>
              <div>
                <p className={styles.tlRole}>{roleText(s)}</p>
                <p className={styles.tlShow}>
                  <Link href={`/shows/${s.slug}`}>{s.title}</Link>
                  {w && <span> · {w.venue}</span>}
                </p>
              </div>
              {w && (
                <ButtonLink href={w.href} variant="outline" className={styles.tlCta}>
                  Билеты
                </ButtonLink>
              )}
            </div>
          </li>
        )
      })}
      {archive.length > 0 && <li className={styles.tlGroup}>Архив</li>}
      {archive.map((s) => (
        <li key={s.slug} className={`${styles.tlItem} ${styles.tlPast}`}>
          <span className={styles.tlWhen}>—</span>
          <span className={styles.tlDot} aria-hidden="true" />
          <div className={styles.tlBody}>
            <div>
              <p className={styles.tlRole}>{roleText(s)}</p>
              <p className={styles.tlShow}>{s.title}</p>
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** З — «Гримёрка»: фото в раме зеркала с лампочками, роль — на бирке под ним. */
function Mirror({ shows, archive }: Props) {
  return (
    <ul className={styles.mirrors}>
      {shows.map((s) => {
        const w = when(s)
        return (
          <li key={s.slug} className={styles.mirror}>
            <div className={styles.mirrorFrame}>
              <div className={styles.mirrorGlass}>
                <Photo s={s} sizes="(min-width: 64rem) 25vw, 50vw" />
              </div>
            </div>
            <p className={styles.mirrorTag}>{roleText(s)}</p>
            <p className={styles.mirrorShow}>
              <Link href={`/shows/${s.slug}`}>{s.title}</Link>
            </p>
            <p className={styles.muted}>
              {w ? `${w.day} ${w.month}, ${w.time} · ${w.venue}` : 'Даты появятся позже'}
            </p>
          </li>
        )
      })}
      {archive.map((s) => (
        <li key={s.slug} className={`${styles.mirror} ${styles.mirrorPast}`}>
          <div className={styles.mirrorFrame}>
            <div className={styles.mirrorGlass}>
              <Image src={s.posterUrl} alt="" fill sizes="25vw" className={styles.cover} />
            </div>
          </div>
          <p className={styles.mirrorTag}>{roleText(s)}</p>
          <p className={styles.mirrorShow}>{s.title}</p>
          <p className={styles.muted}>Архив</p>
        </li>
      ))}
    </ul>
  )
}

/** И — «Билетики»: роль как билет, дата — на отрывном корешке. */
function Tickets({ shows, archive }: Props) {
  return (
    <ul className={styles.tickets}>
      {shows.map((s) => {
        const w = when(s)
        return (
          <li key={s.slug} className={styles.ticket}>
            <div className={styles.ticketMain}>
              <p className={styles.kicker}>{hasCharacter(s) ? 'в роли' : 'в спектакле'}</p>
              <p className={styles.ticketRole}>{roleText(s)}</p>
              <p className={styles.ticketShow}>
                <Link href={`/shows/${s.slug}`}>{s.title}</Link>
              </p>
            </div>
            <div className={styles.ticketStub}>
              {w ? (
                <>
                  <b>{w.day}</b>
                  <span>{w.month}</span>
                  <span>{w.time}</span>
                  <Link href={w.href} className={styles.ticketLink}>
                    Билеты
                  </Link>
                </>
              ) : (
                <span className={styles.ticketSoon}>даты скоро</span>
              )}
            </div>
          </li>
        )
      })}
      {archive.map((s) => (
        <li key={s.slug} className={`${styles.ticket} ${styles.ticketUsed}`}>
          <div className={styles.ticketMain}>
            <p className={styles.kicker}>архив</p>
            <p className={styles.ticketRole}>{roleText(s)}</p>
            <p className={styles.ticketShow}>{s.title}</p>
          </div>
          <div className={styles.ticketStub}>
            <span className={styles.ticketStamp}>погашен</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** К — «Занавес»: узкие полосы-кулисы; наведённая раскрывается в кадр с ролью. */
function Curtain({ shows }: Props) {
  return (
    <ul className={styles.curtain}>
      {shows.map((s, i) => {
        const w = when(s)
        return (
          <li key={s.slug} className={styles.fold} tabIndex={0} data-first={i === 0 || undefined}>
            <Photo s={s} sizes="50vw" />
            <span className={styles.foldTitle}>{s.title}</span>
            <div className={styles.foldBody}>
              <p className={styles.kickerLight}>{s.title}</p>
              <p className={styles.foldRole}>{roleText(s)}</p>
              <p className={styles.foldWhen}>
                {w ? `${w.day} ${w.month}, ${w.time} · ${w.venue}` : 'Даты появятся позже'}
              </p>
              <Link href={`/shows/${s.slug}`} className={styles.stretch} aria-label={s.title} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Л — «Титры»: как финальные титры — роль, отточие, спектакль. */
function Credits({ shows, archive }: Props) {
  return (
    <div className={styles.credits}>
      <ul>
        {shows.map((s) => {
          const w = when(s)
          return (
            <li key={s.slug} className={styles.creditRow}>
              <span className={styles.creditRole}>{roleText(s)}</span>
              <span className={styles.creditDots} aria-hidden="true" />
              <Link href={`/shows/${s.slug}`} className={styles.creditShow}>
                {s.title}
              </Link>
              <span className={styles.creditWhen}>{w ? `${w.day} ${w.month}` : ''}</span>
            </li>
          )
        })}
      </ul>
      {archive.length > 0 && (
        <>
          <p className={styles.creditsGroup}>Прежде</p>
          <ul>
            {archive.map((s) => (
              <li key={s.slug} className={`${styles.creditRow} ${styles.creditPast}`}>
                <span className={styles.creditRole}>{roleText(s)}</span>
                <span className={styles.creditDots} aria-hidden="true" />
                <span className={styles.creditShow}>{s.title}</span>
                <span className={styles.creditWhen} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** М — «Мозаика»: ближайшая роль — большая плитка, остальные мельче, архив ч/б. */
function Mosaic({ shows, archive }: Props) {
  const sorted = [...shows].sort(
    (a, b) =>
      (a.next ? Date.parse(a.next.startsAt) : Infinity) -
      (b.next ? Date.parse(b.next.startsAt) : Infinity),
  )
  return (
    <ul className={styles.mosaic}>
      {sorted.map((s, i) => {
        const w = when(s)
        return (
          <li key={s.slug} className={`${styles.tile} ${i === 0 ? styles.tileBig : ''}`}>
            <Photo s={s} sizes={i === 0 ? '50vw' : '25vw'} />
            <div className={styles.tileCap}>
              {w && (
                <p className={styles.kickerLight}>
                  {i === 0 ? 'Ближайший показ · ' : ''}
                  {w.day} {w.month}, {w.time}
                </p>
              )}
              <p className={styles.tileRole}>{roleText(s)}</p>
              <p className={styles.tileShow}>{s.title}</p>
            </div>
            <Link href={`/shows/${s.slug}`} className={styles.stretch} aria-label={s.title} />
          </li>
        )
      })}
      {archive.map((s) => (
        <li key={s.slug} className={`${styles.tile} ${styles.tilePast}`}>
          <Image src={s.posterUrl} alt="" fill sizes="25vw" className={styles.cover} />
          <div className={styles.tileCap}>
            <p className={styles.kickerLight}>Архив</p>
            <p className={styles.tileRole}>{roleText(s)}</p>
            <p className={styles.tileShow}>{s.title}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function RolesLab(props: Props) {
  return (
    <div className={styles.lab}>
      {(
        [
          ['a', 'А · Программка', Programme],
          ['b', 'Б · Кулисы', Strip],
          ['c', 'В · Афиша роли', Billboard],
          ['d', 'Г · Табло', Board],
          ['e', 'Д · Портрет', Portrait],
          ['f', 'Е · Плакаты', Posters],
          ['g', 'Ж · Хронология', Timeline],
          ['h', 'З · Гримёрка', Mirror],
          ['i', 'И · Билетики', Tickets],
          ['k', 'К · Занавес', Curtain],
          ['l', 'Л · Титры', Credits],
          ['m', 'М · Мозаика', Mosaic],
        ] as const
      ).map(([id, label, View]) => (
        <section key={id} id={`v-${id}`} className={styles.variant}>
          <p className={styles.variantLabel}>{label}</p>
          <h2 className={styles.h2}>Роли в спектаклях</h2>
          <View {...props} />
        </section>
      ))}
    </div>
  )
}
