import type { MemoryCommerceStore } from '@/modules/inventory/memoryStore'

import {
  VISIBLE_ORDER_STATUSES,
  type OrderRecord,
  type TicketRecord,
  type TicketsStore,
} from './store'

type Dump = ReturnType<MemoryCommerceStore['dump']>

/**
 * Те же запросы поверх хранилища в памяти (dev с ACCOUNTS_STORE=memory и тесты). Возвратов
 * в памяти нет — `refundForNotice` всегда null.
 */
export function memoryTicketsStore(source: Pick<MemoryCommerceStore, 'dump'>): TicketsStore {
  const ticketsOf = (d: Dump, match: (t: Dump['tickets'][number]) => boolean): TicketRecord[] =>
    d.tickets
      .filter(match)
      .flatMap((t) => {
        const order = d.orders.find((o) => o.id === t.orderId)
        const item = d.items.find((i) => i.id === t.orderItemId)
        if (!order || !item) return []
        return [
          {
            id: t.id,
            number: t.number,
            orderId: t.orderId,
            orderNumber: order.number,
            orderStatus: order.status,
            customerId: order.customerId,
            performanceId: t.performanceId,
            ticketTypeId: t.ticketTypeId,
            seatId: t.seatId,
            categoryTitle: item.titleSnapshot,
            status: t.status,
            tokenVersion: t.tokenVersion,
            priceKopecks: t.priceKopecks,
            bonusKopecks: t.bonusKopecks,
            cashKopecks: t.cashKopecks,
            feeKopecks: t.feeKopecks,
            issuedAt: t.issuedAt,
            refundedAt: t.refundedAt,
          },
        ]
      })
      .sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0))

  const orderOf = (d: Dump, o: Dump['orders'][number]): OrderRecord => ({
    id: o.id,
    number: o.number,
    customerId: o.customerId,
    status: o.status,
    grossKopecks: o.grossKopecks,
    bonusKopecks: o.bonusKopecks,
    feeKopecks: o.feeKopecks,
    cashKopecks: o.cashKopecks,
    reviewReason: o.reviewReason,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    items: d.items
      .filter((i) => i.orderId === o.id)
      .map((i) => ({
        id: i.id,
        performanceId: i.performanceId,
        ticketTypeId: i.ticketTypeId,
        seatId: i.seatId,
        title: i.titleSnapshot,
        unitPriceKopecks: i.unitPriceKopecks,
        quantity: i.quantity,
        lineGrossKopecks: i.lineGrossKopecks,
        lineBonusKopecks: i.lineBonusKopecks,
        lineFeeKopecks: i.lineFeeKopecks,
      })),
  })

  return {
    async ticketsOfCustomer(customerId) {
      const d = source.dump()
      const own = new Set(d.orders.filter((o) => o.customerId === customerId).map((o) => o.id))
      return ticketsOf(d, (t) => own.has(t.orderId))
    },
    async ordersOfCustomer(customerId) {
      const d = source.dump()
      const visible: readonly string[] = VISIBLE_ORDER_STATUSES
      return d.orders
        .filter((o) => o.customerId === customerId && visible.includes(o.status))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((o) => orderOf(d, o))
    },
    async ticketByNumber(number) {
      return ticketsOf(source.dump(), (t) => t.number === number)[0] ?? null
    },
    async ticketByTokenHash(tokenHash) {
      return ticketsOf(source.dump(), (t) => t.tokenHash === tokenHash)[0] ?? null
    },
    async orderForNotice(orderId) {
      const d = source.dump()
      const order = d.orders.find((o) => o.id === orderId)
      if (!order) return null
      return {
        ...orderOf(d, order),
        email: order.email,
        tickets: ticketsOf(d, (t) => t.orderId === orderId),
      }
    },
    async refundForNotice() {
      return null
    },
  }
}
