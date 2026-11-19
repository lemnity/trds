'use client'

import { useRef, useState, type KeyboardEvent } from 'react'

import { formatRub } from '@/lib/money'
import {
  SEAT_ZONE_COLORS,
  blockSlots,
  seatCategoryColor,
  seatPlace,
  type PerformanceSeating,
  type Seat,
  type SeatRow,
} from '@/modules/seating'

import { FloorSvg, hasFloor } from './FloorSvg'
import styles from './SeatMap.module.css'

// Цвета категорий по схеме театра; подобраны с контрастом ≥ 3:1 к белому (WCAG 1.4.11).
// Категория также указана текстом в легенде и в подписи каждого места.
/** Цвета ценовых зон — общие с редактором схемы в админке. */
export const SEAT_CATEGORY_COLORS = SEAT_ZONE_COLORS

type Props = {
  seating: PerformanceSeating
  selectedIds: string[]
  /** Без цен места только показываются (продажа закрыта). */
  interactive: boolean
  maxSeats: number
  onToggle: (seatId: string) => void
}

/** Визуальная колонка места: боковые секции рядов 1–7 по краям, центр — колонки 2–10. */
const columnOf = (seat: Seat, row: SeatRow) =>
  row.blocks.length === 1 ? seat.number + 1 : seat.number - 1

export function SeatMap({ seating, selectedIds, interactive, maxSeats, onToggle }: Props) {
  const { plan, pricesKopecks, unavailableSeatIds } = seating
  const unavailable = new Set(unavailableSeatIds)
  const selected = new Set(selectedIds)
  const firstSeat = plan.rows[0]?.blocks[0]?.seats[0]
  const [activeId, setActiveId] = useState(firstSeat?.id ?? '')
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const titleOf = new Map(plan.categories.map((c) => [c.id, c.title]))

  const upper = plan.rows.filter((r) => r.blocks.length > 1)
  const lower = plan.rows.filter((r) => r.blocks.length === 1)

  const focusSeat = (id: string | undefined) => {
    if (!id) return
    setActiveId(id)
    refs.current.get(id)?.focus()
  }

  // Стрелки двигают фокус по схеме (roving tabindex): Tab не проходит все 136 мест.
  const onKeyDown = (event: KeyboardEvent, seat: Seat, rowIndex: number) => {
    const row = plan.rows[rowIndex]!
    const seats = row.blocks.flatMap((b) => b.seats)
    const index = seats.findIndex((s) => s.id === seat.id)
    const nearestIn = (target: SeatRow | undefined) => {
      if (!target) return undefined
      const column = columnOf(seat, row)
      return target.blocks
        .flatMap((b) => b.seats)
        .reduce<Seat | undefined>((best, s) => {
          const d = Math.abs(columnOf(s, target) - column)
          return !best || d < Math.abs(columnOf(best, target) - column) ? s : best
        }, undefined)?.id
    }
    const moves: Record<string, () => string | undefined> = {
      ArrowRight: () => seats[index + 1]?.id,
      ArrowLeft: () => seats[index - 1]?.id,
      ArrowDown: () => nearestIn(plan.rows[rowIndex + 1]),
      ArrowUp: () => nearestIn(plan.rows[rowIndex - 1]),
      Home: () => seats[0]?.id,
      End: () => seats.at(-1)?.id,
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    focusSeat(move())
  }

  const renderSeat = (seat: Seat, rowIndex: number) => {
    const color = seatCategoryColor(plan, seat.categoryId)
    const price = pricesKopecks[seat.categoryId]
    const taken = unavailable.has(seat.id)
    const isSelected = selected.has(seat.id)
    const label = [
      seatPlace(plan, seat),
      titleOf.get(seat.categoryId),
      price !== undefined ? formatRub(price) : 'цена уточняется',
      taken ? 'занято' : isSelected ? 'выбрано' : 'свободно',
    ].join(', ')

    if (!interactive) {
      return (
        <span
          key={seat.id}
          className={`${styles.seat} ${taken ? styles.taken : ''}`}
          style={{ '--seat-color': color } as React.CSSProperties}
          title={label}
          aria-hidden="true"
        />
      )
    }

    const blocked = taken || (!isSelected && selected.size >= maxSeats)
    return (
      <button
        key={seat.id}
        ref={(el) => {
          if (el) refs.current.set(seat.id, el)
          else refs.current.delete(seat.id)
        }}
        type="button"
        className={`${styles.seat} ${taken ? styles.taken : ''}`}
        style={{ '--seat-color': color } as React.CSSProperties}
        aria-label={label}
        aria-pressed={isSelected}
        aria-disabled={blocked}
        tabIndex={seat.id === activeId ? 0 : -1}
        onFocus={() => setActiveId(seat.id)}
        onKeyDown={(e) => onKeyDown(e, seat, rowIndex)}
        onClick={() => !blocked && onToggle(seat.id)}
      >
        <span className={styles.seatNumber} aria-hidden="true">
          {seat.number}
        </span>
      </button>
    )
  }

  const renderRow = (row: SeatRow) => {
    const rowIndex = plan.rows.indexOf(row)
    const blocks = row.blocks
    return (
      <div
        key={row.number}
        className={styles.row}
        role="group"
        aria-label={row.label ?? `Ряд ${row.number}`}
      >
        <span className={styles.rowNum} aria-hidden="true">
          {row.number}
        </span>
        {blocks.length > 1 ? (
          blocks.map((b) => (
            <span key={b.section} className={`${styles.block} ${styles[b.section]}`}>
              {blockSlots(b).map((s, i) =>
                s ? (
                  renderSeat(s, rowIndex)
                ) : (
                  <span key={`gap-${i}`} className={styles.gap} aria-hidden="true" />
                ),
              )}
            </span>
          ))
        ) : (
          <span className={`${styles.block} ${styles.center}`}>
            {blocks[0]!.seats.map((s) => renderSeat(s, rowIndex))}
          </span>
        )}
        <span className={styles.rowNum} aria-hidden="true">
          {row.number}
        </span>
      </div>
    )
  }

  return (
    <div className={styles.wrap} data-inactive={!interactive}>
      <ul className={styles.legend} aria-label="Ценовые категории">
        {plan.categories.map((c) => (
          <li key={c.id}>
            <span
              className={styles.swatch}
              style={{ '--seat-color': seatCategoryColor(plan, c.id) } as React.CSSProperties}
              aria-hidden="true"
            />
            {c.title}
            {pricesKopecks[c.id] !== undefined && (
              <span className={styles.legendPrice}> · {formatRub(pricesKopecks[c.id]!)}</span>
            )}
          </li>
        ))}
      </ul>
      {seating.pricesPlaceholder && (
        <p className={styles.placeholder}>Цены предварительные и могут измениться.</p>
      )}

      <p className={styles.swipe} aria-hidden="true">
        ← Схему можно прокрутить в сторону →
      </p>
      {/* Схема шире телефона — прокручивается внутри себя, страница не уезжает. */}
      {hasFloor(plan) ? (
        <div className={styles.floor}>
          <FloorSvg
            plan={plan}
            ariaLabel={plan.title}
            classes={{
              room: styles.floorRoom,
              bar: styles.floorBar,
              barIcon: styles.floorBarIcon,
              column: styles.floorColumn,
              stage: styles.floorStage,
              stageLabel: styles.floorStageLabel,
              table: styles.floorTable,
              tableLabel: styles.floorTableLabel,
            }}
            renderSeat={(seat) => {
              const color = seatCategoryColor(plan, seat.categoryId)
              const price = pricesKopecks[seat.categoryId]
              const taken = unavailable.has(seat.id)
              const isSelected = selected.has(seat.id)
              const blocked = !interactive || taken || (!isSelected && selected.size >= maxSeats)
              const label = [
                seatPlace(plan, seat),
                titleOf.get(seat.categoryId),
                price !== undefined ? formatRub(price) : 'цена уточняется',
                taken ? 'занято' : isSelected ? 'выбрано' : 'свободно',
              ].join(', ')
              return (
                <g
                  key={seat.id}
                  className={styles.floorSeat}
                  data-taken={taken}
                  style={{ '--seat-color': color } as React.CSSProperties}
                  {...(interactive && !taken
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        'aria-label': label,
                        'aria-pressed': isSelected,
                        'aria-disabled': blocked,
                        onClick: () => !blocked && onToggle(seat.id),
                        onKeyDown: (e: React.KeyboardEvent) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          e.preventDefault()
                          if (!blocked) onToggle(seat.id)
                        },
                      }
                    : { 'aria-hidden': true })}
                >
                  <title>{label}</title>
                  <circle cx={seat.x} cy={seat.y} r={taken ? 4.5 : 7.5} />
                  {isSelected && (
                    <text
                      x={seat.x}
                      y={seat.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className={styles.floorSeatNumber}
                    >
                      {seat.number}
                    </text>
                  )}
                </g>
              )
            }}
          />
        </div>
      ) : (
        <div className={styles.scroller}>
          <div className={styles.hall} role="group" aria-label={plan.title}>
            <p className={styles.stage}>Сцена</p>
            <div className={styles.upper}>{upper.map(renderRow)}</div>
            {/* Узкая нижняя часть есть только у Т-образных залов (Дом актёра); у Белинского нет. */}
            {lower.length > 0 && (
              <div className={styles.lower}>
                {lower.map(renderRow)}
                <p className={styles.zone}>Партер</p>
              </div>
            )}
          </div>
        </div>
      )}

      {interactive && (
        <p className={styles.help}>
          Нажмите на место, чтобы добавить его в заказ. Стрелки перемещают по схеме.
        </p>
      )}
    </div>
  )
}
