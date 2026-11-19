import type { Seat, SeatBlock, SeatRow, SeatingPlan } from './types'

/**
 * Зал «Белинского» по схеме театра (получена 19.11.2026): 7 рядов, слева блок на 6 позиций,
 * справа на 5. Серые точки на схеме — мест нет (ряд 1 слева 5–6, ряд 7 в середине): позиции
 * сохраняются пропусками, чтобы ряды стояли ровно. 68 мест, 4 ценовые категории по рядам.
 * ДОПУЩЕНИЕ до подтверждения театром: номер места — номер позиции в ряду слева направо
 * (слева 1–6, справа 7–11), пропуски номера не занимают («места нет» — без номера).
 */
const LEFT = 6
const RIGHT = 5

/** Занятые позиции блоков по рядам; остальное — «места нет». */
const ROWS: Array<{ left: number[]; right: number[] }> = [
  { left: [1, 2, 3, 4], right: [1, 2, 3, 4, 5] },
  ...Array.from({ length: 5 }, () => ({ left: [1, 2, 3, 4, 5, 6], right: [1, 2, 3, 4, 5] })),
  { left: [1, 2], right: [4, 5] },
]

const CATEGORY_BY_ROW: Record<number, string> = {
  1: 'cat-1',
  2: 'cat-1',
  3: 'cat-2',
  4: 'cat-2',
  5: 'cat-3',
  6: 'cat-3',
  7: 'cat-4',
}

const block = (
  section: SeatBlock['section'],
  row: number,
  width: number,
  cols: number[],
  offset: number,
): SeatBlock => ({
  section,
  width,
  seats: cols.map((col): Seat => ({
    id: `r${row}-s${offset + col}`,
    row,
    number: offset + col,
    categoryId: CATEGORY_BY_ROW[row]!,
    col,
  })),
})

const rows: SeatRow[] = ROWS.map(({ left, right }, i) => ({
  number: i + 1,
  blocks: [block('left', i + 1, LEFT, left, 0), block('right', i + 1, RIGHT, right, LEFT)],
}))

export const belinskogoPlan: SeatingPlan = {
  id: 'belinskogo',
  version: 1,
  venueId: 'belinskogo',
  title: 'Белинского',
  categories: [
    { id: 'cat-1', title: 'Ряды 1–2', color: '#e30613' },
    { id: 'cat-2', title: 'Ряды 3–4', color: '#5b57ae' },
    { id: 'cat-3', title: 'Ряды 5–6', color: '#a196c8' },
    { id: 'cat-4', title: 'Ряд 7', color: '#2f9e6b' },
  ],
  rows,
}
