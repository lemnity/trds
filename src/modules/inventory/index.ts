import config from '@payload-config'
import { getPayload } from 'payload'

import { createInventoryService, type InventoryService } from './inventory'
import { memoryCommerceStore } from './memoryStore'
import { pgCommerceStore } from './pgStore'
import type { CommerceStore } from './store'

export {
  InventoryInvariantError,
  acquire,
  capacityFromPerformance,
  commit,
  release,
  returnSold,
  type AcquireMode,
  type CapacitySpec,
  type InventoryLine,
  type InventoryService,
  type SyncResult,
  type Unavailable,
  type UnavailableReason,
} from './inventory'
export { TX_ATTEMPTS, withRetry } from './retry'
export type {
  CommerceStore,
  CommerceTx,
  HoldRow,
  InventoryKey,
  InventoryRow,
  OrderItemRow,
  OrderRow,
  RefundRow,
  RefundStatus,
  RefundTicketRow,
  SeatRow,
  SeatStatus,
  TicketRow,
} from './store'

const memoryStore = globalThis as typeof globalThis & {
  __turdusCommerce?: ReturnType<typeof memoryCommerceStore>
}

export const isMemoryCommerce = () =>
  process.env.NODE_ENV !== 'production' && process.env.ACCOUNTS_STORE === 'memory'

let store: Promise<CommerceStore> | undefined

/**
 * Хранилище ядра продаж на PostgreSQL (соединение Payload). Разработка без базы:
 * ACCOUNTS_STORE=memory (тот же флаг, что у кабинета и кошелька); в production не работает.
 */
export function getCommerceStore() {
  store ??= (async () => {
    // Один экземпляр на процесс: API-маршруты и страницы Next собирает отдельными модулями.
    if (isMemoryCommerce()) return (memoryStore.__turdusCommerce ??= memoryCommerceStore())
    const payload = await getPayload({ config })
    return pgCommerceStore(payload.db.drizzle as unknown as Parameters<typeof pgCommerceStore>[0])
  })()
  // Не запоминаем неудачу (база была недоступна) — следующий запрос попробует снова.
  store.catch(() => {
    store = undefined
  })
  return store
}

let service: Promise<InventoryService> | undefined

/** Остатки и синхронизация вместимости (CMS ↔ inventory). */
export function getInventory() {
  service ??= getCommerceStore().then((s) => createInventoryService({ store: s }))
  service.catch(() => {
    service = undefined
  })
  return service
}
