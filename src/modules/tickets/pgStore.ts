import { and, asc, eq, inArray } from '@payloadcms/db-postgres/drizzle'
import type { NodePgDatabase } from '@payloadcms/db-postgres/drizzle/node-postgres'

import {
  commerceOrderItems,
  commerceOrders,
  commerceRefunds,
  commerceRefundTickets,
  commerceTickets,
} from '@/db/schema/commerce'

import { snapshotFromColumns } from './performances'
import {
  VISIBLE_ORDER_STATUSES,
  type OrderItemRecord,
  type OrderRecord,
  type TicketRecord,
  type TicketsStore,
} from './store'

type Db = NodePgDatabase<Record<string, never>>

const ticketColumns = {
  id: commerceTickets.id,
  number: commerceTickets.number,
  orderId: commerceTickets.orderId,
  orderNumber: commerceOrders.number,
  orderStatus: commerceOrders.status,
  customerId: commerceOrders.customerId,
  performanceId: commerceTickets.performanceId,
  ticketTypeId: commerceTickets.ticketTypeId,
  seatId: commerceTickets.seatId,
  categoryTitle: commerceOrderItems.titleSnapshot,
  showTitleSnapshot: commerceOrderItems.showTitleSnapshot,
  showSlugSnapshot: commerceOrderItems.showSlugSnapshot,
  startsAtSnapshot: commerceOrderItems.startsAtSnapshot,
  venueTitleSnapshot: commerceOrderItems.venueTitleSnapshot,
  venueAddressSnapshot: commerceOrderItems.venueAddressSnapshot,
  status: commerceTickets.status,
  tokenVersion: commerceTickets.tokenVersion,
  priceKopecks: commerceTickets.priceKopecks,
  bonusKopecks: commerceTickets.bonusKopecks,
  cashKopecks: commerceTickets.cashKopecks,
  feeKopecks: commerceTickets.feeKopecks,
  issuedAt: commerceTickets.issuedAt,
  refundedAt: commerceTickets.refundedAt,
}

const itemColumns = {
  id: commerceOrderItems.id,
  orderId: commerceOrderItems.orderId,
  performanceId: commerceOrderItems.performanceId,
  ticketTypeId: commerceOrderItems.ticketTypeId,
  seatId: commerceOrderItems.seatId,
  title: commerceOrderItems.titleSnapshot,
  showTitleSnapshot: commerceOrderItems.showTitleSnapshot,
  showSlugSnapshot: commerceOrderItems.showSlugSnapshot,
  startsAtSnapshot: commerceOrderItems.startsAtSnapshot,
  venueTitleSnapshot: commerceOrderItems.venueTitleSnapshot,
  venueAddressSnapshot: commerceOrderItems.venueAddressSnapshot,
  unitPriceKopecks: commerceOrderItems.unitPriceKopecks,
  quantity: commerceOrderItems.quantity,
  lineGrossKopecks: commerceOrderItems.lineGrossKopecks,
  lineBonusKopecks: commerceOrderItems.lineBonusKopecks,
  lineFeeKopecks: commerceOrderItems.lineFeeKopecks,
}

/** Билеты кабинета, QR и писем на PostgreSQL. Только SELECT — без блокировок и записи. */
export function pgTicketsStore(db: Db): TicketsStore {
  const tickets = async (where: ReturnType<typeof eq>): Promise<TicketRecord[]> => {
    const rows = await db
      .select(ticketColumns)
      .from(commerceTickets)
      .innerJoin(commerceOrders, eq(commerceOrders.id, commerceTickets.orderId))
      .innerJoin(commerceOrderItems, eq(commerceOrderItems.id, commerceTickets.orderItemId))
      .where(where)
      .orderBy(asc(commerceTickets.number))
    return rows.map(
      ({
        showTitleSnapshot,
        showSlugSnapshot,
        startsAtSnapshot,
        venueTitleSnapshot,
        venueAddressSnapshot,
        ...t
      }) => ({
        ...(t as Omit<TicketRecord, 'snapshot'>),
        snapshot: snapshotFromColumns({
          showTitleSnapshot,
          showSlugSnapshot,
          startsAtSnapshot,
          venueTitleSnapshot,
          venueAddressSnapshot,
        }),
      }),
    )
  }

  const itemsOf = async (orderIds: string[]) => {
    const map = new Map<string, OrderItemRecord[]>()
    if (!orderIds.length) return map
    const rows = await db
      .select(itemColumns)
      .from(commerceOrderItems)
      .where(inArray(commerceOrderItems.orderId, orderIds))
      .orderBy(asc(commerceOrderItems.id))
    for (const {
      orderId,
      showTitleSnapshot,
      showSlugSnapshot,
      startsAtSnapshot,
      venueTitleSnapshot,
      venueAddressSnapshot,
      ...item
    } of rows) {
      const list = map.get(orderId) ?? []
      list.push({
        ...item,
        snapshot: snapshotFromColumns({
          showTitleSnapshot,
          showSlugSnapshot,
          startsAtSnapshot,
          venueTitleSnapshot,
          venueAddressSnapshot,
        }),
      })
      map.set(orderId, list)
    }
    return map
  }

  const orderSelect = {
    id: commerceOrders.id,
    number: commerceOrders.number,
    customerId: commerceOrders.customerId,
    status: commerceOrders.status,
    grossKopecks: commerceOrders.grossKopecks,
    bonusKopecks: commerceOrders.bonusKopecks,
    feeKopecks: commerceOrders.feeKopecks,
    cashKopecks: commerceOrders.cashKopecks,
    reviewReason: commerceOrders.reviewReason,
    createdAt: commerceOrders.createdAt,
    paidAt: commerceOrders.paidAt,
  }

  return {
    ticketsOfCustomer: (customerId) => tickets(eq(commerceOrders.customerId, customerId)),

    async ordersOfCustomer(customerId) {
      const rows = await db
        .select(orderSelect)
        .from(commerceOrders)
        .where(
          and(
            eq(commerceOrders.customerId, customerId),
            inArray(commerceOrders.status, [...VISIBLE_ORDER_STATUSES]),
          ),
        )
        .orderBy(asc(commerceOrders.createdAt))
      const items = await itemsOf(rows.map((r) => r.id))
      return rows.map((r): OrderRecord => ({ ...r, items: items.get(r.id) ?? [] }))
    },

    async ticketByNumber(number) {
      const [row] = await tickets(eq(commerceTickets.number, number))
      return row ?? null
    },

    async ticketByTokenHash(tokenHash) {
      const [row] = await tickets(eq(commerceTickets.tokenHash, tokenHash))
      return row ?? null
    },

    async orderForNotice(orderId) {
      const [order] = await db
        .select({ ...orderSelect, email: commerceOrders.email })
        .from(commerceOrders)
        .where(eq(commerceOrders.id, orderId))
      if (!order) return null
      const [items, list] = await Promise.all([
        itemsOf([orderId]),
        tickets(eq(commerceTickets.orderId, orderId)),
      ])
      return { ...order, items: items.get(orderId) ?? [], tickets: list }
    },

    async refundForNotice(refundId) {
      const [refund] = await db
        .select({
          id: commerceRefunds.id,
          status: commerceRefunds.status,
          cashKopecks: commerceRefunds.cashKopecks,
          bonusKopecks: commerceRefunds.bonusKopecks,
          feeKopecks: commerceRefunds.feeKopecks,
          orderId: commerceOrders.id,
          orderNumber: commerceOrders.number,
          email: commerceOrders.email,
        })
        .from(commerceRefunds)
        .innerJoin(commerceOrders, eq(commerceOrders.id, commerceRefunds.orderId))
        .where(eq(commerceRefunds.id, refundId))
      if (!refund) return null
      const numbers = await db
        .select({ number: commerceTickets.number })
        .from(commerceRefundTickets)
        .innerJoin(commerceTickets, eq(commerceTickets.id, commerceRefundTickets.ticketId))
        .where(eq(commerceRefundTickets.refundId, refundId))
        .orderBy(asc(commerceTickets.number))
      const { orderId, orderNumber, email, ...rest } = refund
      return {
        ...rest,
        order: { id: orderId, number: orderNumber, email },
        ticketNumbers: numbers.map((n) => n.number),
      }
    },
  }
}
