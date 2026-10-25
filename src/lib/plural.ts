/**
 * Форма слова по числу (русский язык, три формы): plural(3, 'билет', 'билета', 'билетов') →
 * «билета». 1, 21, 101 — первая; 2–4, 22–24 — вторая; 0, 5–20, 11–14, 111 — третья. Один helper
 * на сайт и кабинет: счётчики, подписи остатков, бонусов и приглашений.
 */
export const plural = (n: number, one: string, few: string, many: string): string => {
  const abs = Math.abs(Math.trunc(n))
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
