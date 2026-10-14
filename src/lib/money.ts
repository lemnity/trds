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
