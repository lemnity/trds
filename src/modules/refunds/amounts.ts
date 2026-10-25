import { allocate } from '@/modules/checkout'
import type { TicketRow } from '@/modules/inventory/store'

/**
 * Суммы возврата (architecture.md §7: «единая таблица соответствия возвращённым билетам и долям
 * бонусной оплаты; округление детерминировано»). Доли каждого билета записаны при выпуске
 * (`allocate` по позициям), поэтому сумма частичных возвратов всегда равна сумме заказа: ни
 * копейки сверху, ни потерянной копейки.
 */

export type TicketShare = {
  ticketId: string
  /** Деньги на карту: денежная часть цены + сбор, если он возвращается. */
  cashKopecks: number
  /** Потраченные на билет бонусы — вернутся на бонусный счёт. */
  bonusKopecks: number
  /** Часть `cashKopecks`, приходящаяся на сервисный сбор. */
  feeKopecks: number
}

export type RefundAmounts = {
  shares: TicketShare[]
  cashKopecks: number
  bonusKopecks: number
  feeKopecks: number
}

type ShareSource = Pick<TicketRow, 'id' | 'cashKopecks' | 'bonusKopecks' | 'feeKopecks'>

/** Доли и итог возврата по билетам (сбор — по политике или решению сотрудника). */
export const refundAmounts = (
  tickets: readonly ShareSource[],
  { includeFee }: { includeFee: boolean },
): RefundAmounts => {
  const shares = [...tickets]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((t) => {
      const fee = includeFee ? t.feeKopecks : 0
      return {
        ticketId: t.id,
        cashKopecks: t.cashKopecks + fee,
        bonusKopecks: t.bonusKopecks,
        feeKopecks: fee,
      }
    })
  const sum = (key: 'cashKopecks' | 'bonusKopecks' | 'feeKopecks') =>
    shares.reduce((n, s) => n + s[key], 0)
  const amounts = {
    shares,
    cashKopecks: sum('cashKopecks'),
    bonusKopecks: sum('bonusKopecks'),
    feeKopecks: sum('feeKopecks'),
  }
  if (!Number.isSafeInteger(amounts.cashKopecks)) throw new RangeError('refund total overflow')
  return amounts
}

/**
 * Какая часть начисленных за заказ бонусов приходится на билеты возврата. Начисление (3% от
 * денежной части билетов) раскладывается `allocate` по всем билетам заказа с весом денежной
 * части — одинаково при каждом возврате, поэтому сумма сторно всех частичных возвратов ровно
 * равна начислению. Билеты сортируются по номеру — порядок не зависит от выборки из БД.
 */
export const reversalShare = (
  accruedKopecks: number,
  orderTickets: readonly Pick<TicketRow, 'id' | 'number' | 'cashKopecks'>[],
  refundedTicketIds: ReadonlySet<string>,
): number => {
  if (accruedKopecks === 0 || orderTickets.length === 0) return 0
  const sorted = [...orderTickets].sort((a, b) =>
    a.number < b.number ? -1 : a.number > b.number ? 1 : 0,
  )
  const weights = sorted.map((t) => t.cashKopecks)
  // Все билеты оплачены бонусами целиком (денежной части нет) — начисления не было.
  if (weights.every((w) => w === 0)) return 0
  const parts = allocate(accruedKopecks, weights)
  return sorted.reduce((n, t, i) => n + (refundedTicketIds.has(t.id) ? parts[i]! : 0), 0)
}
