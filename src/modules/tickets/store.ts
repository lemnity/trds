import type { OrderStatus } from '@/modules/checkout'
import type { TicketStatus } from '@/modules/inventory/store'

import type { ShowSnapshot } from './performances'

/**
 * Чтение билетов и заказов для кабинета, QR и писем (T-046, T-047, T-051). Только чтение: статусы
 * меняет `@/modules/orders` (state-machine), здесь их лишь показывают. Хранилище — PostgreSQL
 * (`pgStore.ts`, тот же drizzle, что у ядра продаж) или память dev/тестов (`memoryStore.ts`).
 */

export type TicketRecord = {
  id: string
  number: string
  orderId: string
  orderNumber: string
  orderStatus: OrderStatus
  /** Владелец — покупатель заказа; у гостевого заказа пусто. */
  customerId: string | null
  performanceId: string
  ticketTypeId: string
  seatId: string | null
  /** Название категории — снимок на момент заказа (TICKETS-03). */
  categoryTitle: string
  /** Снимок показа из позиции заказа; null — позиция до снимков (данные из афиши). */
  snapshot: ShowSnapshot | null
  status: TicketStatus
  tokenVersion: number
  priceKopecks: number
  bonusKopecks: number
  cashKopecks: number
  feeKopecks: number
  issuedAt: Date
  refundedAt: Date | null
}

export type OrderItemRecord = {
  id: string
  performanceId: string
  ticketTypeId: string
  seatId: string | null
  title: string
  snapshot: ShowSnapshot | null
  unitPriceKopecks: number
  quantity: number
  lineGrossKopecks: number
  lineBonusKopecks: number
  lineFeeKopecks: number
}

export type OrderRecord = {
  id: string
  number: string
  customerId: string | null
  status: OrderStatus
  grossKopecks: number
  bonusKopecks: number
  feeKopecks: number
  cashKopecks: number
  reviewReason: string | null
  createdAt: Date
  paidAt: Date | null
  items: OrderItemRecord[]
}

/** Данные письма о заказе: почта получателя читается в момент отправки, в outbox её нет. */
export type OrderNotice = OrderRecord & { email: string; tickets: TicketRecord[] }

export type RefundNotice = {
  id: string
  status: string
  cashKopecks: number
  bonusKopecks: number
  feeKopecks: number
  order: Pick<OrderNotice, 'id' | 'number' | 'email'>
  ticketNumbers: string[]
}

/** Заказы, которые видны в кабинете: оплаченные и дальше. Черновики и неоплаченные — нет. */
export const VISIBLE_ORDER_STATUSES = [
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'NEEDS_REVIEW',
] as const satisfies readonly OrderStatus[]

export interface TicketsStore {
  /** Билеты заказов покупателя (`commerce_orders.customer_id`). */
  ticketsOfCustomer(customerId: string): Promise<TicketRecord[]>
  ordersOfCustomer(customerId: string): Promise<OrderRecord[]>
  ticketByNumber(number: string): Promise<TicketRecord | null>
  ticketByTokenHash(tokenHash: string): Promise<TicketRecord | null>
  orderForNotice(orderId: string): Promise<OrderNotice | null>
  refundForNotice(refundId: string): Promise<RefundNotice | null>
}
