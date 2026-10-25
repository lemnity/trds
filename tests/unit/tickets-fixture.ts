import { createInventoryService } from '../../src/modules/inventory/inventory'
import { memoryCommerceStore } from '../../src/modules/inventory/memoryStore'
import type { CommerceStore } from '../../src/modules/inventory/store'
import { createOrderService } from '../../src/modules/orders/service'
import type { ShowsData } from '../../src/modules/shows/types'
import { performanceLookupFrom } from '../../src/modules/tickets/performances'

/** Общие данные тестов билетов (T-046/T-047/T-051): один спектакль, два показа, два покупателя. */

export const NOW = new Date('2026-11-10T10:00:00Z')
export const PAYLOAD_SECRET = 'tickets-test-payload-secret-0123456789abcdef'
export const ALICE = '11111111-1111-4111-8111-111111111111'
export const BOB = '22222222-2222-4222-8222-222222222222'

export const showsData: ShowsData = {
  venues: [
    { id: 'bar', title: 'Бар «Тест»', address: 'Екатеринбург, ул. Тестовая, 1', kind: 'bar' },
  ],
  shows: [
    {
      slug: 'gabi',
      title: 'Габи; спектакль, с запятой',
      genre: null,
      ageLimit: 18,
      durationMinutes: 120,
      lead: '',
      description: [],
      credits: [],
      eventType: 'spectacle',
      gallery: [],
      posterUrl: '/p.jpg',
      status: 'published',
    },
  ],
  performances: [
    {
      id: 'p-future',
      showSlug: 'gabi',
      venueId: 'bar',
      startsAt: '2026-11-20T19:00:00+05:00',
      ticketTypes: [{ id: 'std', title: 'Входной', priceKopecks: 150_000, capacity: 10 }],
    },
    {
      id: 'p-past',
      showSlug: 'gabi',
      venueId: 'bar',
      startsAt: '2026-11-01T19:00:00+05:00',
      ticketTypes: [{ id: 'std', title: 'Входной', priceKopecks: 150_000, capacity: 10 }],
    },
  ],
}

export const lookup = performanceLookupFrom(showsData)

/**
 * Ядро продаж на выбранном хранилище: остатки двух показов, заказ покупателя оплачен —
 * билеты выпущены тем же `createOrderService`, что и в production.
 */
export async function commerce<S extends CommerceStore>(
  store: S,
  ticketSecret: string,
  capacity = 10,
) {
  const inventory = createInventoryService({ store })
  const orders = createOrderService({
    store,
    ticketSecret,
    retry: { sleep: async () => undefined },
  })
  for (const id of ['p-future', 'p-past'])
    await inventory.syncCapacity({ performanceId: id, ticketTypes: [{ id: 'std', capacity }] }, NOW)
  let seq = 0
  const buy = async (
    customerId: string | null,
    performanceId: string,
    quantity: number,
    { bonus = 0, at = new Date('2026-10-25T10:00:00Z') } = {},
  ) => {
    const placed = await orders.placeOrder(
      {
        idempotencyKey: `t-${performanceId}-${++seq}-${Math.random()}`,
        email: `buyer${seq}@example.com`,
        customerId,
        lines: [
          {
            performanceId,
            ticketTypeId: 'std',
            title: 'Входной',
            unitPriceKopecks: 150_000,
            quantity,
          },
        ],
        bonusKopecks: bonus,
        feePerTicketKopecks: 0,
      },
      at,
    )
    if (!placed.ok) throw new Error(`placeOrder failed: ${JSON.stringify(placed)}`)
    const paid = await orders.confirmPayment(
      {
        orderId: placed.order.id,
        provider: 'bank',
        providerPaymentId: `pay-${placed.order.id}`,
        amountKopecks: placed.order.cashKopecks,
        currency: 'RUB',
      },
      new Date(at.getTime() + 60_000),
    )
    if (!paid.ok) throw new Error('confirmPayment failed')
    return { order: placed.order, tickets: paid.tickets }
  }
  return { store, inventory, orders, buy }
}

export const memoryCommerce = (ticketSecret: string) =>
  commerce(memoryCommerceStore(), ticketSecret)
