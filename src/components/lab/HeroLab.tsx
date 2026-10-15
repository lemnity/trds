'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, type ReactNode } from 'react'

import { ButtonLink } from '../ui/ButtonLink'
import { TicketIcon } from '../ui/TicketIcon'
import styles from './HeroLab.module.css'

export type LabSlide = {
  id: string
  href: string
  title: string
  day: string
  month: string
  longDate: string
  weekday: string
  time: string
  venue: string
  meta: string
  photo: string
  salesOpen: boolean
}

const VARIANTS = [
  { key: 'u', label: 'У · Плёнка' },
  { key: 'r', label: 'Р · Мозаика' },
  { key: 'z', label: 'З · Кулисы' },
  { key: 'e', label: 'Е · Триптих' },
  { key: 'g', label: 'Г · Табло' },
  { key: 'a', label: 'А · Афиша' },
  { key: 'zh', label: 'Ж · Билет' },
  { key: 'i', label: 'И · Бегущая строка' },
  { key: 'b', label: 'Б · Кинотитр' },
  { key: 'e2', label: 'Э · Занавес' },
  { key: 'yu', label: 'Ю · Карусель' },
  { key: 'ya', label: 'Я · Окно в буквах' },
  { key: 'y', label: 'Ы · Вкладки дат' },
  { key: 'sch', label: 'Щ · Наплыв' },
] as const
type Key = (typeof VARIANTS)[number]['key']

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Фото с плавной сменой: прежнее остаётся под новым, пока новое проявляется и чуть
 * «отъезжает» из лёгкого приближения. Прежний src — производное состояние, без эффектов.
 */
function CrossImage({ src, sizes }: { src: string; sizes: string }) {
  const [cur, setCur] = useState(src)
  const [prev, setPrev] = useState<string | null>(null)
  if (src !== cur) {
    setPrev(cur)
    setCur(src)
  }
  return (
    <>
      {prev && (
        <Image key={`p-${prev}`} src={prev} alt="" fill sizes={sizes} className={styles.imgPrev} />
      )}
      <Image key={cur} src={cur} alt="" fill sizes={sizes} className={styles.imgIn} />
    </>
  )
}

const Chevron = ({ dir }: { dir: 'l' | 'r' }) => (
  <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
    <path
      d={dir === 'l' ? 'M12.5 4.5 7 10l5.5 5.5' : 'M7.5 4.5 13 10l-5.5 5.5'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

type V = { s: LabSlide[]; i: number; go: (n: number) => void }

function Cta({ x, light = false }: { x: LabSlide; light?: boolean }) {
  return (
    <ButtonLink href={x.href} className={light ? styles.ctaLight : styles.ctaDark}>
      {x.salesOpen ? (
        <>
          <TicketIcon /> Купить билет
        </>
      ) : (
        'Подробнее о показе'
      )}
    </ButtonLink>
  )
}

function Arrows({
  i,
  n,
  go,
  dark = false,
}: {
  i: number
  n: number
  go: (n: number) => void
  dark?: boolean
}) {
  return (
    <div className={`${styles.arrows} ${dark ? styles.arrowsDark : ''}`}>
      <span className={styles.counter}>
        <b>{pad(i + 1)}</b> / {pad(n)}
      </span>
      <button type="button" onClick={() => go(i - 1)} aria-label="Предыдущий">
        <Chevron dir="l" />
      </button>
      <button type="button" onClick={() => go(i + 1)} aria-label="Следующий">
        <Chevron dir="r" />
      </button>
    </div>
  )
}

/** Следующие N слайдов по кругу, начиная с текущего. */
const ring = (s: LabSlide[], i: number, n: number) =>
  Array.from({ length: Math.min(n, s.length) }, (_, k) => ({
    x: s[(i + k) % s.length]!,
    k: (i + k) % s.length,
  }))

/** У — Плёнка: кадры на киноленте, текущий цветной и широкий. */
function Film({ s, i, go }: V) {
  const x = s[i]!
  return (
    <div className={styles.film}>
      <div className={styles.holes} />
      <div className={styles.filmRow}>
        {ring(s, i, 4).map(({ x: f, k }, n) => (
          <button
            key={n}
            type="button"
            className={styles.frame}
            data-on={n === 0 || undefined}
            onClick={() => go(k)}
            aria-label={`${f.longDate}: ${f.title}`}
          >
            <CrossImage src={f.photo} sizes="40vw" />
            {n > 0 && (
              <span key={f.id} className={`${styles.frameCap} ${styles.enter}`}>
                <small>{f.longDate}</small>
                <b>{f.title}</b>
              </span>
            )}
          </button>
        ))}
      </div>
      <div className={styles.holes} />
      <div className={styles.filmInfo}>
        <div key={x.id} className={styles.enter}>
          <p className={styles.mutedLight}>
            {x.longDate}, {x.weekday} · {x.time} · {x.venue}
          </p>
          <h2 className={styles.filmTitle}>{x.title}</h2>
        </div>
        <div className={styles.filmAct}>
          <Arrows i={i} n={s.length} go={go} dark />
          <Cta x={x} light />
        </div>
      </div>
    </div>
  )
}

/** Р — Мозаика: большая плитка + 4 малых; клик по малой делает её главной. */
function Mosaic({ s, i, go }: V) {
  return (
    <div className={styles.mosaic}>
      {ring(s, i, 5).map(({ x, k }, n) =>
        n === 0 ? (
          <div key="big" className={`${styles.tile} ${styles.tileBig}`}>
            <CrossImage src={x.photo} sizes="50vw" />
            <div key={x.id} className={`${styles.tileCapBig} ${styles.enter}`}>
              <p>
                {x.longDate}, {x.weekday} · {x.time}
              </p>
              <h2>{x.title}</h2>
              <p>
                {x.meta} · {x.venue}
              </p>
              <Cta x={x} light />
            </div>
          </div>
        ) : (
          <button key={n} type="button" className={styles.tile} onClick={() => go(k)}>
            <CrossImage src={x.photo} sizes="25vw" />
            <span key={x.id} className={`${styles.tileCap} ${styles.enter}`}>
              <small>
                {x.longDate} · {x.time}
              </small>
              <b>{x.title}</b>
            </span>
          </button>
        ),
      )}
    </div>
  )
}

/** З — Кулисы: панели-полосы, активная раскрыта; клик или наведение раскрывает. */
function Curtains({ s, i, go }: V) {
  return (
    <div className={styles.curtains}>
      {s.slice(0, 6).map((x, k) => (
        <div
          key={x.id}
          className={styles.panel}
          data-on={k === i || undefined}
          onMouseEnter={() => go(k)}
        >
          <CrossImage src={x.photo} sizes="60vw" />
          {k === i ? (
            <div className={`${styles.panelCap} ${styles.enter}`}>
              <p>
                {x.longDate}, {x.weekday} · {x.time}
              </p>
              <h2>{x.title}</h2>
              <p>
                {x.meta} · {x.venue}
              </p>
              <Cta x={x} light />
            </div>
          ) : (
            <button type="button" className={styles.panelMini} onClick={() => go(k)}>
              <small>{x.longDate}</small>
              <b>{x.title}</b>
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/** Е — Триптих: три показа в ряд, текущий большой и цветной. */
function Triptych({ s, i, go }: V) {
  return (
    <div className={styles.trip}>
      <div className={styles.tripHead}>
        <p className={styles.eyebrow}>Скоро на сцене</p>
        <Arrows i={i} n={s.length} go={go} />
      </div>
      <div className={styles.tripRow}>
        {ring(s, i, 3).map(({ x, k }, n) => (
          <figure key={n} className={styles.tripTile} data-on={n === 0 || undefined}>
            <button
              type="button"
              className={styles.tripImg}
              onClick={() => go(k)}
              aria-label={x.title}
            >
              <CrossImage src={x.photo} sizes={n === 0 ? '50vw' : '25vw'} />
            </button>
            <figcaption key={x.id} className={styles.enter}>
              <small>
                {x.longDate}, {x.weekday} · {x.time}
              </small>
              <b>{x.title}</b>
              <span>{n === 0 ? `${x.meta} · ${x.venue}` : x.venue}</span>
              {n === 0 && <Cta x={x} />}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}

/** Г — Табло: фото текущего слева, список ближайших показов справа. */
function Board({ s, i, go }: V) {
  const x = s[i]!
  return (
    <div className={styles.board}>
      <div className={styles.boardPhoto}>
        <CrossImage src={x.photo} sizes="60vw" />
        <div key={x.id} className={`${styles.boardCap} ${styles.enter}`}>
          <p>
            {x.longDate}, {x.weekday} · {x.time}
          </p>
          <h2>{x.title}</h2>
          <p>
            {x.meta} · {x.venue}
          </p>
          <Cta x={x} light />
        </div>
      </div>
      <div className={styles.boardList}>
        <p className={styles.eyebrowLight}>Ближайшие показы</p>
        <ol>
          {s.slice(0, 6).map((r, k) => (
            <li key={r.id}>
              <button type="button" data-on={k === i || undefined} onClick={() => go(k)}>
                <span className={styles.boardDay}>
                  {r.day}
                  <small>{r.month}</small>
                </span>
                <span className={styles.boardText}>
                  <b>{r.title}</b>
                  <small>
                    {r.venue} · {r.time}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <Link href="/afisha" className={styles.boardAll}>
          Вся афиша
        </Link>
      </div>
    </div>
  )
}

/** А — Афиша: тёмная плашка с текстом слева, чистое фото справа. */
function Poster({ s, i, go }: V) {
  const x = s[i]!
  return (
    <div className={styles.split}>
      {/* Строгая сетка: у каждой строки постоянная высота — при смене слайда ничего не скачет. */}
      <div className={styles.splitText}>
        <div key={x.id} className={`${styles.splitBody} ${styles.enter}`}>
          <p className={styles.splitWhen}>
            <span>{x.longDate}</span>
            <span>{x.weekday}</span>
            <span>{x.time}</span>
          </p>
          <h2
            className={styles.splitTitle}
            data-len={x.title.length > 26 ? 'long' : x.title.length > 14 ? 'mid' : undefined}
          >
            {x.title}
          </h2>
          <p className={styles.splitMeta}>
            {x.meta}
            <br />
            {x.venue}
          </p>
          <div className={styles.splitAct}>
            <Cta x={x} light />
          </div>
        </div>
        <div className={styles.splitCtl}>
          <Arrows i={i} n={s.length} go={go} dark />
          <div className={styles.splitDots} aria-hidden="true">
            {s.map((r, k) => (
              <i key={r.id} data-on={k === i || undefined} />
            ))}
          </div>
        </div>
      </div>
      <div className={styles.splitPhoto}>
        <CrossImage src={x.photo} sizes="55vw" />
      </div>
    </div>
  )
}

/** Ж — Билет: фото с названием и корешок с датой, временем и площадкой. */
function Ticket({ s, i, go }: V) {
  const x = s[i]!
  return (
    <div className={styles.ticket}>
      <div className={styles.ticketPhoto}>
        <CrossImage src={x.photo} sizes="70vw" />
        <div key={x.id} className={`${styles.ticketCap} ${styles.enter}`}>
          <p className={styles.eyebrowLight}>Модный театр TURDUS представляет</p>
          <h2>{x.title}</h2>
          <p>{x.meta}</p>
        </div>
      </div>
      <div className={styles.stub}>
        <dl key={x.id} className={styles.enter}>
          <div>
            <dt>Дата</dt>
            <dd>
              <b className={styles.stubBig}>{x.day}</b>
              {x.longDate.replace(/^\d+\s/, '')}, {x.weekday}
            </dd>
          </div>
          <div>
            <dt>Начало</dt>
            <dd>
              <b>{x.time}</b>
            </dd>
          </div>
          <div>
            <dt>Площадка</dt>
            <dd>
              <b>{x.venue}</b>
            </dd>
          </div>
        </dl>
        <Cta x={x} />
        <Arrows i={i} n={s.length} go={go} />
      </div>
    </div>
  )
}

/** И — Бегущая строка: фото на весь блок, внизу лента всех ближайших показов. */
function Ticker({ s, i, go }: V) {
  const x = s[i]!
  const items = s.map((r, k) => (
    <button key={r.id} type="button" className={styles.tickItem} onClick={() => go(k)}>
      <b>{r.longDate}</b> {r.title} <em>{r.venue}</em>
      <i aria-hidden="true">✦</i>
    </button>
  ))
  return (
    <div className={styles.tick}>
      <div className={styles.tickPhoto}>
        <CrossImage src={x.photo} sizes="100vw" />
        <div className={styles.tickTop}>
          <p key={x.id} className={styles.enter}>
            <span>
              {x.longDate}, {x.weekday} · {x.time}
            </span>
          </p>
          <Arrows i={i} n={s.length} go={go} dark />
        </div>
        <div key={x.id} className={`${styles.tickCap} ${styles.enter}`}>
          <h2>{x.title}</h2>
          <div className={styles.tickLine}>
            <p>
              {x.meta} · {x.venue}
            </p>
            <Cta x={x} light />
          </div>
        </div>
      </div>
      <div className={styles.tickBand} aria-label="Ближайшие показы">
        <div className={styles.tickTrack}>
          {items}
          <span aria-hidden="true" inert className={styles.tickCopy}>
            {items}
          </span>
        </div>
      </div>
    </div>
  )
}

/** Б — Кинотитр: фото на весь блок, крупное название внизу, как титр в кино. */
function Titles({ s, i, go }: V) {
  const x = s[i]!
  return (
    <div className={styles.titles}>
      <CrossImage src={x.photo} sizes="100vw" />
      <div key={x.id} className={`${styles.titlesCap} ${styles.enter}`}>
        <p>
          {x.longDate}, {x.weekday} · {x.time}
        </p>
        <h2>{x.title}</h2>
        <p>
          {x.meta} · {x.venue}
        </p>
        <Cta x={x} light />
      </div>
      <div className={styles.titlesCtl}>
        <Arrows i={i} n={s.length} go={go} dark />
      </div>
    </div>
  )
}

/** Э — Занавес: при смене две половины занавеса сходятся и расходятся, открывая сцену. */
function Curtain({ s, i, go }: V) {
  const x = s[i]!
  return (
    <div className={styles.stage}>
      <CrossImage src={x.photo} sizes="100vw" />
      <span key={`l-${x.id}`} className={`${styles.drape} ${styles.drapeL}`} aria-hidden="true" />
      <span key={`r-${x.id}`} className={`${styles.drape} ${styles.drapeR}`} aria-hidden="true" />
      <div key={x.id} className={`${styles.stageCap} ${styles.enter}`}>
        <p>
          {x.longDate}, {x.weekday} · {x.time}
        </p>
        <h2>{x.title}</h2>
        <p>
          {x.meta} · {x.venue}
        </p>
        <Cta x={x} light />
      </div>
      <div className={styles.stageCtl}>
        <Arrows i={i} n={s.length} go={go} dark />
      </div>
    </div>
  )
}

/** Ю — Карусель: текущий спектакль по центру, соседи по бокам в перспективе. */
function Coverflow({ s, i, go }: V) {
  const n = s.length
  return (
    <div className={styles.flow}>
      <div className={styles.flowTrack}>
        {s.map((x, k) => {
          let d = k - i
          if (d > n / 2) d -= n
          if (d < -n / 2) d += n
          if (Math.abs(d) > 2) return null
          return (
            <button
              key={x.id}
              type="button"
              className={styles.flowCard}
              style={{ '--d': d, '--ad': Math.abs(d) } as React.CSSProperties}
              data-on={d === 0 || undefined}
              onClick={() => go(k)}
              aria-label={x.title}
            >
              <Image src={x.photo} alt="" fill sizes="40vw" />
            </button>
          )
        })}
      </div>
      <div key={s[i]!.id} className={`${styles.flowCap} ${styles.enter}`}>
        <p>
          {s[i]!.longDate}, {s[i]!.weekday} · {s[i]!.time} · {s[i]!.venue}
        </p>
        <h2>{s[i]!.title}</h2>
        <Cta x={s[i]!} />
      </div>
      <div className={styles.flowCtl}>
        <Arrows i={i} n={n} go={go} />
      </div>
    </div>
  )
}

/** Я — Окно в буквах: название набрано огромными буквами, внутри букв — фото спектакля. */
function Letters({ s, i, go }: V) {
  const x = s[i]!
  return (
    <div className={styles.letters}>
      <div className={styles.lettersTop}>
        <p>
          {x.longDate}, {x.weekday} · {x.time}
        </p>
        <Arrows i={i} n={s.length} go={go} dark />
      </div>
      <h2
        key={x.id}
        className={styles.lettersTitle}
        data-len={x.title.length > 22 ? 'long' : x.title.length > 12 ? 'mid' : undefined}
        style={{ backgroundImage: `url(${x.photo})` }}
      >
        {x.title}
      </h2>
      <div key={`c-${x.id}`} className={`${styles.lettersFoot} ${styles.enter}`}>
        <p>
          {x.meta} · {x.venue}
        </p>
        <Cta x={x} light />
      </div>
    </div>
  )
}

/** Ы — Вкладки дат: сверху ряд дат-вкладок, под ним фото и описание выбранного показа. */
function DateTabs({ s, i, go }: V) {
  const x = s[i]!
  return (
    <div className={styles.tabs}>
      <div className={styles.tabRow} role="tablist" aria-label="Даты показов">
        {s.map((r, k) => (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={k === i}
            className={styles.tab}
            onClick={() => go(k)}
          >
            <b>{r.day}</b>
            <small>
              {r.month} · {r.time}
            </small>
          </button>
        ))}
      </div>
      <div className={styles.tabBody}>
        <div className={styles.tabPhoto}>
          <CrossImage src={x.photo} sizes="60vw" />
        </div>
        <div key={x.id} className={`${styles.tabText} ${styles.enter}`}>
          <p className={styles.eyebrow}>
            {x.longDate}, {x.weekday}
          </p>
          <h2>{x.title}</h2>
          <p>{x.meta}</p>
          <p>
            {x.venue} · начало в {x.time}
          </p>
          <Cta x={x} />
        </div>
      </div>
    </div>
  )
}

/** Щ — Наплыв: фото медленно приближается, пока слайд на экране; смена — наплывом. */
function KenBurns({ s, i, go }: V) {
  const x = s[i]!
  return (
    <div className={styles.kb}>
      <div key={x.id} className={styles.kbImg}>
        <CrossImage src={x.photo} sizes="100vw" />
      </div>
      <div key={`c-${x.id}`} className={`${styles.kbCap} ${styles.enter}`}>
        <p className={styles.eyebrowLight}>
          {pad(i + 1)} — {x.longDate}, {x.weekday} · {x.time}
        </p>
        <h2>{x.title}</h2>
        <p>
          {x.meta} · {x.venue}
        </p>
        <Cta x={x} light />
      </div>
      <div className={styles.kbBar}>
        {s.map((r, k) => (
          <button
            key={r.id}
            type="button"
            data-on={k === i || undefined}
            onClick={() => go(k)}
            aria-label={`Слайд ${k + 1}: ${r.title}`}
          >
            <span>{r.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

const RENDER: Record<Key, (v: V) => ReactNode> = {
  u: Film,
  r: Mosaic,
  z: Curtains,
  e: Triptych,
  g: Board,
  a: Poster,
  zh: Ticket,
  i: Ticker,
  b: Titles,
  e2: Curtain,
  yu: Coverflow,
  ya: Letters,
  y: DateTabs,
  sch: KenBurns,
}

/** Переключатель вариантов + живой вариант (адрес ?v= — можно отправить ссылкой). */
export function HeroLab({ slides }: { slides: LabSlide[] }) {
  const params = useSearchParams()
  const router = useRouter()
  const v = (VARIANTS.find((x) => x.key === params.get('v'))?.key ?? 'u') as Key
  const [i, setI] = useState(0)
  const go = (n: number) => setI((n + slides.length) % slides.length)
  if (!slides.length) return <p>Ближайших показов нет.</p>
  return (
    <div className={styles.lab}>
      <div className={styles.switch} role="tablist" aria-label="Вариант слайдера">
        {VARIANTS.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={x.key === v}
            onClick={() => router.replace(`?v=${x.key}`, { scroll: false })}
          >
            {x.label}
          </button>
        ))}
      </div>
      <section aria-label="Превью слайдера">{RENDER[v]({ s: slides, i, go })}</section>
    </div>
  )
}
