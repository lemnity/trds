export type EntryTicketInput = {
  /** Показ сохранён (есть id). */
  saved: boolean
  /** Выбрана схема зала (seating.planId). */
  planId: unknown
  /** Вместимость из показа (shows.seatsPerPerformance). */
  seats: unknown
  canCreate: boolean
  /** Уже есть категории билетов; null — ещё не знаем. */
  hasCategories: boolean | null
}

export type EntryTicketState =
  { kind: 'hidden' } | { kind: 'save-first' } | { kind: 'button'; seats: number }

/** Вместимость «входного билета» из значения поля показа или null. */
export function entrySeats(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null
}

/** id показа из значения поля `show` (число/строка или объект). */
export function showIdOf(value: unknown): string | number | null {
  if (typeof value === 'number' || (typeof value === 'string' && value !== '')) return value
  if (value && typeof value === 'object' && 'id' in value) {
    return showIdOf((value as { id: unknown }).id)
  }
  return null
}

/** Что показывать в блоке «Билеты (категории)»: кнопку, подсказку или ничего. */
export function entryTicketState(input: EntryTicketInput): EntryTicketState {
  const noPlan = typeof input.planId !== 'string' || input.planId === ''
  const seats = entrySeats(input.seats)
  if (!noPlan || seats === null || !input.canCreate) return { kind: 'hidden' }
  if (!input.saved) return { kind: 'save-first' }
  if (input.hasCategories !== false) return { kind: 'hidden' }
  return { kind: 'button', seats }
}
