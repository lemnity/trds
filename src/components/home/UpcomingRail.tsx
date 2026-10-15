'use client'

import { Button } from '@heroui/react'
import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'

import type { PerformanceView } from '@/modules/shows'

import { ShowCard } from '../board/ShowCard'
import styles from './UpcomingRail.module.css'

export type RailItem = { item: PerformanceView; posterUrl: string }

const COPIES = [-1, 0, 1] as const
/** Сколько спектаклей в ленте. */
const MAX_SHOWS = 12

const noopSubscribe = () => () => {}
const EPSILON = 4

const Chevron = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
    <path
      d={dir === 'left' ? 'M12.5 4.5 7 10l5.5 5.5' : 'M7.5 4.5 13 10l-5.5 5.5'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/**
 * «Ближайшие спектакли» — бесконечная лента вбок без автопрокрутки: листается стрелками
 * и свайпом. Список выводится трижды; после прокрутки позиция незаметно возвращается в
 * среднюю копию, поэтому края у ленты нет. Боковые копии скрыты от экранных дикторов
 * и клавиатуры (aria-hidden + inert).
 */
type Props = {
  /** Все предстоящие показы по возрастанию даты; лента берёт ближайший показ каждого спектакля. */
  items: RailItem[]
  /** Заголовок секции — слева в строке со стрелками. */
  title: ReactNode
  /** Ссылка «Вся афиша» — справа, перед стрелками. */
  more?: ReactNode
  headClassName?: string
}

export function UpcomingRail({ items, title, more, headClassName }: Props) {
  // Статическая сборка фиксирует список на момент build: начавшиеся показы убираем в
  // браузере ДО выбора ближайших, иначе спектакль пропал бы целиком, а лента стартовала бы
  // не с первой карточки. На сервере ничего не скрываем (снимок «ничего не началось»).
  const startedKey = useSyncExternalStore(
    noopSubscribe,
    () =>
      items
        .filter(({ item }) => Date.parse(item.startsAt) <= Date.now())
        .map(({ item }) => item.id)
        .join(','),
    () => '',
  )
  const started = new Set(startedKey ? startedKey.split(',') : [])
  const seen = new Set<string>()
  const shows = items
    .filter(({ item }) => !started.has(item.id))
    .filter(({ item }) => !seen.has(item.show.slug) && Boolean(seen.add(item.show.slug)))
    .slice(0, MAX_SHOWS)

  const viewportRef = useRef<HTMLDivElement>(null)
  const middleRef = useRef<HTMLUListElement>(null)
  const settleTimer = useRef<number>(undefined)

  /**
   * Средняя копия занимает диапазон прокрутки [start, start + ширина копии). start учитывает
   * scroll-padding: при прилипании первая карточка стоит не у самого края, а с полем.
   */
  const middleRange = () => {
    const viewport = viewportRef.current
    const middle = middleRef.current
    if (!viewport || !middle) return null
    const pad = parseFloat(getComputedStyle(viewport).scrollPaddingLeft) || 0
    return { viewport, start: middle.offsetLeft - pad, width: middle.offsetWidth }
  }

  /** Если ушли в боковую копию — мгновенно перескакиваем на то же место в средней. */
  const recenter = () => {
    const range = middleRange()
    if (!range || !range.width) return
    const { viewport, start, width } = range
    const pos = viewport.scrollLeft
    // Допуск на дробные пиксели: scroll-padding в rem (32.0013px), а scrollLeft — целый.
    const shift = pos < start - EPSILON ? width : pos >= start + width - EPSILON ? -width : 0
    if (shift) viewport.scrollTo({ left: pos + shift, behavior: 'instant' })
  }

  // Старт — с самого ближайшего показа; пересчёт, когда список поменялся.
  useLayoutEffect(() => {
    const range = middleRange()
    range?.viewport.scrollTo({ left: range.start, behavior: 'instant' })
  }, [items, startedKey])

  // scrollend есть не во всех браузерах — ждём паузу в прокрутке.
  const onScroll = () => {
    window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(recenter, 150)
  }

  const step = (dir: 1 | -1) => {
    const viewport = viewportRef.current
    const card = middleRef.current?.firstElementChild as HTMLElement | null
    if (!viewport || !card) return
    const gap = parseFloat(getComputedStyle(middleRef.current!).columnGap) || 0
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    viewport.scrollBy({
      left: dir * (card.offsetWidth + gap),
      behavior: reduce ? 'instant' : 'smooth',
    })
  }

  return (
    <div className={styles.rail}>
      <div className={headClassName ? `${styles.head} ${headClassName}` : styles.head}>
        {title}
        <div className={styles.actions}>
          {more}
          <div className={styles.arrows}>
            <Button
              variant="outline"
              isIconOnly
              aria-label="Предыдущие спектакли"
              onPress={() => step(-1)}
            >
              <Chevron dir="left" />
            </Button>
            <Button
              variant="outline"
              isIconOnly
              aria-label="Следующие спектакли"
              onPress={() => step(1)}
            >
              <Chevron dir="right" />
            </Button>
          </div>
        </div>
      </div>
      <div ref={viewportRef} className={styles.viewport} onScroll={onScroll}>
        <div className={styles.track}>
          {COPIES.map((copy) => (
            <ul
              key={copy}
              ref={copy === 0 ? middleRef : undefined}
              className={styles.list}
              aria-hidden={copy !== 0 || undefined}
              inert={copy !== 0 || undefined}
            >
              {shows.map(({ item, posterUrl }) => (
                <li key={item.id} className={styles.item}>
                  <ShowCard item={item} posterUrl={posterUrl} />
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </div>
  )
}
