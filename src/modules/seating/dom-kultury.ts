import type { FloorTable, Seat, SeatRow, SeatingPlan } from './types'

/**
 * Бар «Дом Культуры» по схеме театра (получена 19.11.2026): Г-образный зал, 26 столов (номера 1–22, 25–28), барная
 * стойка и стойка у сцены; 106 мест, продажа поштучно. Координаты — со схемы театра (px).
 * Серые точки на схеме — места, закрытые по умолчанию: при выборе схемы для показа они
 * сразу «закрыты с продажи», администратор включает их на показ.
 * Номер места — по порядку вокруг стола (слева направо, сверху вниз); у стоек — от входа.
 * ДОПУЩЕНИЕ: ценовые категории серых мест заданы по соседству (столы 25–28 — с 19–22,
 * круглые 2, 3, 15–18 — отдельной категорией); театр может переназначить их в админке.
 */

// Схема театра смещена: левый верхний угол помещения — (292, 135).
const OX = 280
const OY = 120
const P = (x: number, y: number) => ({ x: x - OX, y: y - OY })

/** [x, y, закрыто по умолчанию] в координатах схемы театра. */
type S = [number, number, boolean?]
const off = true

type Group = {
  row: number
  label: string
  categoryId: string
  idPrefix: string
  seats: S[]
  table?: Omit<FloorTable, 'row' | 'label'>
}

const rect = (x: number, y: number, w = 26, h = 26, rotate?: number) => ({
  shape: 'rect' as const,
  ...P(x, y),
  w,
  h,
  ...(rotate !== undefined && { rotate }),
})
const round = (x: number, y: number, d = 26) => ({
  shape: 'round' as const,
  ...P(x, y),
  w: d,
  h: d,
})

const table = (n: number, categoryId: string, shape: Group['table'], seats: S[]): Group => ({
  row: n,
  label: `Стол ${n}`,
  categoryId,
  idPrefix: `t${n}`,
  seats,
  table: shape,
})

const GROUPS: Group[] = [
  {
    row: 101,
    label: 'Барная стойка',
    categoryId: 'cat-1',
    idPrefix: 'b1',
    seats: [
      [561, 183, off],
      [561, 206, off],
      [535, 245, off],
      [512, 245],
      [489, 245],
      [466, 245],
      [454, 264],
      [454, 287],
      [454, 310],
      [454, 333],
    ],
  },
  {
    row: 102,
    label: 'Стойка у сцены',
    categoryId: 'cat-2',
    idPrefix: 'b2',
    seats: [
      [361, 691, off],
      [361, 711, off],
      [361, 731, off],
      [361, 751, off],
      [361, 771],
      [361, 791],
      [361, 811, off],
      [361, 831, off],
      [361, 851, off],
      [361, 871, off],
    ],
  },
  ...[28, 27, 26, 25].map((n, i) => {
    const y = 173 + i * 42
    return table(n, 'cat-3', rect(629, y), [
      [606, y, off],
      [652, y - 13, off],
      [652, y, off],
      [652, y + 13, off],
    ])
  }),
  table(22, 'cat-3', rect(413, 482), [
    [391, 482],
    [436, 482],
  ]),
  table(21, 'cat-3', rect(413, 524), [
    [391, 511],
    [391, 524],
    [391, 537],
    [436, 524],
  ]),
  table(20, 'cat-3', rect(413, 567), [
    [391, 567],
    [436, 567],
  ]),
  table(19, 'cat-3', rect(413, 609), [
    [391, 596, off],
    [391, 609, off],
    [391, 622, off],
    [436, 609],
  ]),
  table(1, 'cat-3', rect(608, 503, 28, 58), [
    [585, 488],
    [585, 503],
    [585, 519],
    [631, 477],
    [631, 490],
    [631, 503],
    [631, 516],
    [631, 529],
  ]),
  table(2, 'cat-5', round(608, 659), [
    [608, 637, off],
    [589, 670, off],
    [627, 670, off],
  ]),
  table(3, 'cat-5', round(608, 721), [
    [608, 699, off],
    [589, 732, off],
    [627, 732, off],
  ]),
  table(18, 'cat-5', round(446, 692), [
    [424, 692, off],
    [468, 692, off],
  ]),
  table(17, 'cat-5', round(446, 737), [
    [424, 737, off],
    [468, 737, off],
  ]),
  ...[4, 5, 6].map((n, i) => {
    const x = 679 + i * 42
    return table(n, 'cat-4', rect(x, 778), [
      [x, 755, off],
      [x, 801, off],
    ])
  }),
  table(7, 'cat-4', rect(805, 778), [
    [805, 755],
    [805, 801],
  ]),
  table(8, 'cat-4', rect(893, 771, 42, 26, -22), [
    [870, 760],
    [881, 752],
    [893, 745, off],
    [919, 755, off],
    [893, 797],
    [904, 789],
    [916, 782],
  ]),
  table(9, 'cat-4', rect(945, 836, 26, 26, 30), [
    [925, 824],
    [968, 844],
    [961, 856],
  ]),
  table(10, 'cat-4', rect(920, 870, 26, 26, 40), [
    [906, 852],
    [941, 882],
    [932, 891],
  ]),
  table(11, 'cat-4', rect(886, 895, 26, 26, 30), [
    [875, 875, off],
    [904, 912, off],
    [893, 918, off],
  ]),
  table(12, 'cat-4', rect(847, 908, 26, 26, 10), [
    [841, 886, off],
    [847, 931],
    [859, 929],
  ]),
  table(13, 'cat-4', rect(805, 912), [
    [805, 889, off],
    [798, 935, off],
    [811, 935, off],
  ]),
  table(14, 'cat-4', rect(763, 912), [
    [763, 889, off],
    [763, 935, off],
  ]),
  table(16, 'cat-5', round(666, 849, 28), [
    [650, 833, off],
    [681, 833, off],
    [650, 864, off],
    [681, 864, off],
  ]),
  table(15, 'cat-5', round(738, 849, 28), [
    [722, 833, off],
    [753, 833, off],
    [722, 864, off],
    [753, 864, off],
  ]),
]

const rows: SeatRow[] = [...GROUPS]
  .sort((a, b) => a.row - b.row)
  .map((g) => ({
    number: g.row,
    label: g.label,
    blocks: [
      {
        section: 'center',
        seats: g.seats.map(([x, y], i): Seat => ({
          id: `${g.idPrefix}-s${i + 1}`,
          row: g.row,
          number: i + 1,
          categoryId: g.categoryId,
          ...P(x, y),
        })),
      },
    ],
  }))

export const domKulturyPlan: SeatingPlan = {
  id: 'dom-kultury',
  // v1 — временная копия зала Дома актёра; v2 — планировка бара со столами.
  version: 2,
  venueId: 'dk',
  title: 'Бар «Дом Культуры»',
  categories: [
    { id: 'cat-1', title: 'Барная стойка', color: '#9a9b0f' },
    { id: 'cat-2', title: 'Стойка у сцены', color: '#13a3dd' },
    { id: 'cat-3', title: 'Столы 1, 19–28', color: '#8b4513' },
    { id: 'cat-4', title: 'Столы 4–14', color: '#5b57ae' },
    { id: 'cat-5', title: 'Круглые столы', color: '#c98a2e' },
  ],
  rows,
  defaultClosedSeatIds: GROUPS.flatMap((g) =>
    g.seats.flatMap(([, , closed], i) => (closed ? [`${g.idPrefix}-s${i + 1}`] : [])),
  ),
  floor: {
    width: 720,
    height: 850,
    // Г-образное помещение со скруглённым правым нижним углом.
    outline: `M ${292 - OX + 8} ${135 - OY} H ${677 - OX - 8} q 8 0 8 8 V ${712 - OY} q 0 8 8 8 H ${990 - OX} q 8 0 8 8 V ${790 - OY} C ${998 - OX} ${890 - OY} ${900 - OX} ${960 - OY} ${800 - OX} ${960 - OY} H ${292 - OX + 8} q -8 0 -8 -8 V ${135 - OY + 8} q 0 -8 8 -8 Z`,
    tables: GROUPS.flatMap((g) =>
      g.table ? [{ row: g.row, label: String(g.row), ...g.table }] : [],
    ),
    bars: [
      {
        // Барная стойка «лесенкой» вверху.
        path: `M ${527 - OX} ${155 - OY} H ${550 - OX} V ${235 - OY} H ${443 - OX} V ${355 - OY} H ${385 - OX} V ${330 - OY} H ${420 - OX} V ${210 - OY} H ${527 - OX} Z`,
        ...{ iconX: 485 - OX, iconY: 222 - OY },
      },
      {
        // Стойка у сцены слева.
        path: `M ${292 - OX} ${668 - OY} H ${350 - OX} V ${888 - OY} H ${292 - OX} Z`,
        ...{ iconX: 309 - OX, iconY: 778 - OY },
      },
    ],
    columns: [
      { ...P(417, 799), r: 17 },
      { ...P(634, 799), r: 17 },
    ],
    stage: { ...P(395, 888), w: 196, h: 72 },
  },
}
