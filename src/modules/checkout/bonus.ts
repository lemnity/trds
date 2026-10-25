/**
 * Поле «Бонусы» в корзине: разбор ввода и подписи. Расчёт суммы списания и начисления —
 * только `applyBonus` из `@/modules/loyalty`; здесь математики денег нет.
 */

import { plural } from '@/lib/plural'

const RUBLE = 100
/** До 9 цифр рублей: больше любой корзины и гарантированно безопасное целое в копейках. */
const MAX_DIGITS = 9

export type BonusInput = { ok: true; kopecks: number } | { ok: false }

/**
 * Ввод «сколько списать» — целые рубли → копейки. Без parseFloat (rules.md §3): только цифры,
 * пробелы-разделители тысяч допустимы. Пусто — 0. Дроби, минус, буквы — ошибка.
 */
export const parseBonusRubles = (text: string): BonusInput => {
  const digits = text.replace(/[\s  ]/g, '')
  if (digits === '') return { ok: true, kopecks: 0 }
  if (!/^\d+$/.test(digits)) return { ok: false }
  const significant = digits.replace(/^0+(?=\d)/, '')
  if (significant.length > MAX_DIGITS) return { ok: false }
  return { ok: true, kopecks: Number(significant) * RUBLE }
}

/** Целые рубли для подстановки в поле («Списать максимум»). Копейки отбрасываются. */
export const bonusRublesText = (kopecks: number) => String(Math.floor(kopecks / RUBLE))

/**
 * Демо-баланс превью из localStorage (`turdus:demo-loyalty` = `{"balanceKopecks": N}`).
 * Всё, что не похоже на целые неотрицательные копейки, — 0. Это не настоящий счёт.
 */
export const parseDemoBalance = (raw: string | null): number => {
  if (!raw) return 0
  try {
    const value: unknown = JSON.parse(raw)
    const balance =
      value && typeof value === 'object' && 'balanceKopecks' in value ? value.balanceKopecks : null
    return typeof balance === 'number' && Number.isSafeInteger(balance) && balance > 0 ? balance : 0
  } catch {
    return 0
  }
}

/** Ссылка «Войти» с возвратом в эту же корзину: только относительный путь своего сайта. */
export const loginHrefFor = (pathname: string, search: string) => {
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return '/login'
  const query = search.replace(/^\?/, '')
  return `/login?next=${encodeURIComponent(query ? `${pathname}?${query}` : pathname)}`
}

/** «1 бонус», «2 бонуса», «5 бонусов» — по количеству рублей. */
export const bonusWord = (count: number) => plural(count, 'бонус', 'бонуса', 'бонусов')
