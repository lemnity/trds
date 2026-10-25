import config from '@payload-config'
import { getPayload } from 'payload'

import { getCommerceStore, isMemoryCommerce } from '@/modules/inventory'
import type { MemoryCommerceStore } from '@/modules/inventory/memoryStore'
import { loadShowsData } from '@/modules/site-data'

import { memoryTicketsStore } from './memoryStore'
import { performanceLookupFrom } from './performances'
import { pgTicketsStore } from './pgStore'
import { createTicketsService, type TicketsService } from './service'
import { ticketSecretFrom } from './token'

export {
  DEFAULT_DURATION_MINUTES,
  noPerformanceLookup,
  performanceInfoFor,
  performanceLookupFrom,
  seatLabel,
  snapshotFromColumns,
  type ShowSnapshot,
  type PerformanceInfo,
  type PerformanceLookup,
} from './performances'
export { qrPng, qrSvg } from './qr'
export {
  createTicketsService,
  type QrAccess,
  type TicketsService,
  type TokenCheck,
} from './service'
export type { TicketsStore } from './store'
export {
  ORDER_NUMBER_FORMAT,
  TICKET_NUMBER_FORMAT,
  TICKET_TOKEN_FORMAT,
  ticketSecretFrom,
} from './token'
export {
  groupTickets,
  qrPath,
  ticketState,
  type AccountTickets,
  type OrderView,
  type TicketState,
  type TicketView,
} from './views'

/** Тот же секрет, что у выпуска билетов (`@/modules/orders`): PAYLOAD_SECRET, метка 'turdus:ticket'. */
const secret = () => {
  const base = process.env.PAYLOAD_SECRET || (isMemoryCommerce() ? 'dev' : '')
  if (!base) throw new Error('PAYLOAD_SECRET is not set')
  return ticketSecretFrom(base)
}

let service: Promise<TicketsService> | undefined

/**
 * Билеты кабинета и QR (T-046, T-051) на соединении Payload; dev без базы — память
 * (ACCOUNTS_STORE=memory, общий экземпляр с ядром продаж).
 */
export function getTickets() {
  service ??= (async () => {
    const store = isMemoryCommerce()
      ? memoryTicketsStore((await getCommerceStore()) as unknown as MemoryCommerceStore)
      : pgTicketsStore(
          (await getPayload({ config })).db.drizzle as unknown as Parameters<
            typeof pgTicketsStore
          >[0],
        )
    return createTicketsService({
      store,
      secret: secret(),
      // Основное — снимок показа в позиции заказа; афиша (CMS) — для длительности и старых
      // заказов без снимка. Читается на каждый запрос, чтобы данные были свежими.
      performances: async () => performanceLookupFrom(await loadShowsData()),
    })
  })()
  service.catch(() => {
    service = undefined
  })
  return service
}
