import type { SalePerformance } from '@/modules/shows'

// Общие части шапки спектакля (иконки, минимальная цена).
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
