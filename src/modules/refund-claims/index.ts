import config from '@payload-config'
import { eq } from '@payloadcms/db-postgres/drizzle'
import type { NodePgDatabase } from '@payloadcms/db-postgres/drizzle/node-postgres'
import { getPayload } from 'payload'

import { customers } from '@/db/schema/accounts'
import { log } from '@/lib/log'
import { getCommerceStore, isMemoryCommerce } from '@/modules/inventory'
import { getRefunds } from '@/modules/refunds'
import { THEATRE_TIME_ZONE } from '@/modules/shows/queries'
import { loadShowsData } from '@/modules/site-data'
import { performanceLookupFrom } from '@/modules/tickets/performances'

import { diskClaimFileStorage, memoryClaimFileStorage } from './files'
import { pgClaimStore } from './pgStore'
import { createClaimService, type ClaimService } from './service'
import { memoryClaimStore } from './store'

export {
  MAX_FILE_BYTES,
  MAX_FILES_PER_CLAIM,
  diskClaimFileStorage,
  memoryClaimFileStorage,
  sniffMime,
} from './files'
export {
  createClaimService,
  type ClaimError,
  type ClaimQuote,
  type ClaimService,
  type ClaimView,
  type StaffClaimView,
} from './service'
export { memoryClaimStore, type ClaimRow, type ClaimStatus, type ClaimStore } from './store'

const memory = globalThis as typeof globalThis & {
  __turdusClaims?: ReturnType<typeof memoryClaimStore>
  __turdusClaimFiles?: ReturnType<typeof memoryClaimFileStorage>
}

let service: Promise<ClaimService> | undefined

/** Заявки на возврат на соединении Payload (dev без базы — память). */
export function getRefundClaims() {
  service ??= (async () => {
    const [commerce, refunds] = await Promise.all([getCommerceStore(), getRefunds()])
    const inMemory = isMemoryCommerce()
    const db = inMemory
      ? null
      : ((await getPayload({ config })).db.drizzle as unknown as NodePgDatabase<
          Record<string, never>
        >)
    const claims = inMemory ? (memory.__turdusClaims ??= memoryClaimStore()) : pgClaimStore(db!)
    const files = inMemory
      ? (memory.__turdusClaimFiles ??= memoryClaimFileStorage())
      : diskClaimFileStorage()

    const shows = async () => loadShowsData()
    return createClaimService({
      claims,
      commerce,
      files,
      policy: refunds.policy,
      staffRefund: (input) => refunds.requestStaffRefund(input),
      isPromo: async (performanceId, ticketTypeId) => {
        const data = await shows()
        const p = data.performances.find((x) => x.id === performanceId)
        return p?.ticketTypes.some((t) => t.id === ticketTypeId && t.promo === true) ?? false
      },
      performance: async (performanceId) => {
        const info = performanceLookupFrom(await shows())(performanceId)
        return info ? { startsAt: new Date(info.startsAt), showTitle: info.showTitle } : null
      },
      customerEmail: db
        ? async (customerId) => {
            const [row] = await db
              .select({ email: customers.email })
              .from(customers)
              .where(eq(customers.id, customerId))
              .limit(1)
            return row?.email ?? null
          }
        : undefined,
      timeZone: THEATRE_TIME_ZONE,
      log: log.child({ module: 'refund-claims' }),
    })
  })()
  service.catch(() => {
    service = undefined
  })
  return service
}
