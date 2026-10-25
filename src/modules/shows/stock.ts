import type { ShowsData } from './types'

/**
 * Настоящие остатки на витрине (T-042, T-033). Квоты и цены — из CMS, а сколько занято — только
 * из ядра продаж (`@/modules/inventory`, `availabilityOf`): CMS остаток не хранит (rules.md §2).
 * Тип повторяет `PerformanceStock` из inventory структурно — read model сайта не зависит от
 * серверного модуля продаж.
 */
export type ShowStock = {
  categories: { ticketTypeId: string; capacity: number; sold: number; held: number }[]
  /** Места не в статусе «свободно»: бронь, продажа, закрыты театром. */
  unavailableSeatIds: string[]
}

/**
 * Накладывает остатки на данные афиши: у категории вместимость — из ядра продаж, занято —
 * `sold + held` (бронь тоже недоступна покупателю, пока не истечёт); занятые места схемы
 * добавляются к закрытым в CMS. Показ или категория без строк в ядре продаж (ещё не
 * синхронизированы) остаются с квотами CMS — первая покупка создаст строки сама.
 *
 * Только для показа на страницах: оформление (`POST /api/checkout`) берёт показ без наложения —
 * иначе занятые сейчас места попали бы в закрытые при первичной синхронизации вместимости.
 */
export const applyStock = (data: ShowsData, stock: ReadonlyMap<string, ShowStock>): ShowsData => {
  if (stock.size === 0) return data
  return {
    ...data,
    performances: data.performances.map((p) => {
      const s = stock.get(p.id)
      if (!s) return p
      const rows = new Map(s.categories.map((c) => [c.ticketTypeId, c]))
      return {
        ...p,
        ticketTypes: p.ticketTypes.map((t) => {
          const row = rows.get(t.id)
          return row ? { ...t, capacity: row.capacity, sold: row.sold + row.held } : t
        }),
        ...(p.seating && {
          seating: {
            ...p.seating,
            unavailableSeatIds: [
              ...new Set([...p.seating.unavailableSeatIds, ...s.unavailableSeatIds]),
            ],
          },
        }),
      }
    }),
  }
}

/** Показы, остатки которых нужны витрине: будущие (прошедшие на сайте не продаются). */
export const stockPerformanceIds = (data: ShowsData, now: Date): string[] =>
  data.performances.filter((p) => Date.parse(p.startsAt) > now.getTime()).map((p) => p.id)
