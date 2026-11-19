// Деньги внутри приложения — целые копейки (rules.md §3). Рубли — только при выводе.
const rub = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 0,
})
const rubWithKopecks = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 2,
})

export const formatRub = (kopecks: number): string => {
  if (!Number.isSafeInteger(kopecks))
    throw new RangeError('Amount must be an integer number of kopecks')
  const whole = kopecks % 100 === 0
  // Деление здесь только для отображения; в расчётах не используется.
  return (whole ? rub : rubWithKopecks).format(kopecks / 100)
}

/** Копейки → текст для поля ввода рублей: 150050 → «1500.5», пусто → «». */
export const rubInput = (kopecks: number | null): string =>
  kopecks === null ? '' : String(kopecks / 100)

/** «1500», «1 500,50» → копейки; пусто — без цены; мусор — undefined (не менять). */
export const parseRub = (raw: string): number | null | undefined => {
  const s = raw.replace(/\s/g, '').replace(',', '.')
  if (s === '') return null
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return undefined
  return Math.round(Number(s) * 100)
}
