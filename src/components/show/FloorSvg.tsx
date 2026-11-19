'use client'

import type { ReactNode } from 'react'

import type { FloorPlan, FloorTable, Seat, SeatingPlan } from '@/modules/seating'

/**
 * Планировка зала со столами (бар «Дом Культуры»): помещение, стойки, колонны, сцена и столы —
 * SVG в координатах схемы театра. Места рисует вызывающий (`renderSeat`): на сайте — выбор
 * мест, в админке — выделение и цены. Цвета — через CSS-классы вызывающего.
 */
type Classes = {
  room?: string
  bar?: string
  barIcon?: string
  column?: string
  stage?: string
  stageLabel?: string
  table?: string
  tableLabel?: string
}

type Props = {
  plan: SeatingPlan & { floor: FloorPlan }
  renderSeat: (seat: Seat) => ReactNode
  classes: Classes
  /** Клик по столу — например, выделить все его места. */
  onTableClick?: (table: FloorTable) => void
  tableTitle?: (table: FloorTable) => string
  ariaLabel: string
  /** Админка: протягивание для выделения мест — без прокрутки страницы жестом. */
  lockTouch?: boolean
}

const tableShape = (t: FloorTable, className: string | undefined) => {
  const transform = t.rotate ? `rotate(${t.rotate} ${t.x} ${t.y})` : undefined
  return t.shape === 'round' ? (
    <circle className={className} cx={t.x} cy={t.y} r={t.w / 2} />
  ) : (
    <rect
      className={className}
      x={t.x - t.w / 2}
      y={t.y - t.h / 2}
      width={t.w}
      height={t.h}
      rx={3}
      transform={transform}
    />
  )
}

/** Значок бара: бокал. */
const BarIcon = ({ x, y, className }: { x: number; y: number; className?: string }) => (
  <g transform={`translate(${x - 7} ${y - 7})`} className={className} aria-hidden="true">
    <rect width={14} height={14} rx={2} />
    <path d="M3.5 3.5 H10.5 L7 7.5 Z M7 7.5 V10.5 M5 10.5 H9" fill="none" strokeWidth={1.2} />
  </g>
)

export function FloorSvg({
  plan,
  renderSeat,
  classes,
  onTableClick,
  tableTitle,
  ariaLabel,
  lockTouch,
}: Props) {
  const { floor } = plan
  const seats = plan.rows.flatMap((r) => r.blocks.flatMap((b) => b.seats))
  return (
    <svg
      viewBox={`0 0 ${floor.width} ${floor.height}`}
      width="100%"
      style={{
        maxWidth: floor.width,
        display: 'block',
        margin: '0 auto',
        ...(lockTouch && { touchAction: 'none' }),
      }}
      role="group"
      aria-label={ariaLabel}
    >
      <path className={classes.room} d={floor.outline} />
      {floor.bars.map((b, i) => (
        <g key={i}>
          <path className={classes.bar} d={b.path} />
          <BarIcon x={b.iconX} y={b.iconY} className={classes.barIcon} />
        </g>
      ))}
      {floor.columns.map((c, i) => (
        <circle key={i} className={classes.column} cx={c.x} cy={c.y} r={c.r} />
      ))}
      <rect
        className={classes.stage}
        x={floor.stage.x}
        y={floor.stage.y}
        width={floor.stage.w}
        height={floor.stage.h}
      />
      <text
        className={classes.stageLabel}
        x={floor.stage.x + floor.stage.w / 2}
        y={floor.stage.y + floor.stage.h / 2}
        textAnchor="middle"
        dominantBaseline="central"
      >
        СЦЕНА
      </text>
      {floor.tables.map((t) => (
        <g
          key={t.row}
          onClick={onTableClick ? () => onTableClick(t) : undefined}
          style={onTableClick ? { cursor: 'pointer' } : undefined}
        >
          {tableTitle && <title>{tableTitle(t)}</title>}
          {tableShape(t, classes.table)}
          <text
            className={classes.tableLabel}
            x={t.x}
            y={t.y}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {t.label}
          </text>
        </g>
      ))}
      {seats.map((s) => renderSeat(s))}
    </svg>
  )
}

export const hasFloor = (plan: SeatingPlan): plan is SeatingPlan & { floor: FloorPlan } =>
  !!plan.floor
