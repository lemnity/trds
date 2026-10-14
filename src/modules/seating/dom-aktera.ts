import type { Seat, SeatBlock, SeatRow, SeatingPlan } from './types'

/**
 * Зал Дома актёра по схеме театра (получена 15.10.2026): ряды 1–7 — 2 + 9 + 2 места,
 * ряды 8–12 — 9 мест по центру; 136 мест, 7 ценовых категорий по рядам.
 * ДОПУЩЕНИЕ до подтверждения театром: места нумеруются слева направо сквозь весь ряд
 * (1–13 в рядах 1–7, 1–9 в рядах 8–12) — memory.md, открытые вопросы.
 */
const CATEGORY_BY_ROW: Record<number, string> = {
  1: 'cat-1',
  2: 'cat-2',
  3: 'cat-3',
  4: 'cat-3',
  5: 'cat-4',
  6: 'cat-4',
  7: 'cat-4',
  8: 'cat-5',
  9: 'cat-5',
  10: 'cat-6',
  11: 'cat-6',
  12: 'cat-7',
}

const LAYOUT: Array<[SeatBlock['section'], number]>[] = [
  ...Array.from(
    { length: 7 },
    () =>
      [
        ['left', 2],
        ['center', 9],
        ['right', 2],
      ] as Array<[SeatBlock['section'], number]>,
  ),
  ...Array.from({ length: 5 }, () => [['center', 9]] as Array<[SeatBlock['section'], number]>),
]

const buildRows = (): SeatRow[] =>
  LAYOUT.map((blocks, index) => {
    const rowNumber = index + 1
    let seatNumber = 0
    return {
      number: rowNumber,
      blocks: blocks.map(([section, count]) => ({
        section,
        seats: Array.from({ length: count }, (): Seat => {
          seatNumber += 1
          return {
            id: `r${rowNumber}-s${seatNumber}`,
            row: rowNumber,
            number: seatNumber,
            categoryId: CATEGORY_BY_ROW[rowNumber]!,
          }
        }),
      })),
    }
  })

const tShapedHall = (id: string, venueId: string, title: string): SeatingPlan => ({
  id,
  version: 1,
  venueId,
  title,
  categories: Array.from({ length: 7 }, (_, i) => ({
    id: `cat-${i + 1}`,
    title: `Категория ${i + 1}`,
  })),
  rows: buildRows(),
})

export const domAkteraPlan = tShapedHall('dom-aktera', 'dom-aktera', 'Зал Дома актёра')

/**
 * Бар «Дом Культуры»: заказчик прислал ту же схему, что и для Дома актёра (15.10.2026).
 * Совпадение залов подтвердить у театра (memory.md, открытые вопросы).
 */
export const domKulturyPlan = tShapedHall('dom-kultury', 'dk', 'Зал бара «Дом Культуры»')
