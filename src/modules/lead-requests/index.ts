import config from '@payload-config'
import { getPayload } from 'payload'

import { pgLeadStore } from './pgStore'
import { createLeadRequestService, memoryLeadStore, type LeadRequestService } from './service'

export {
  LEAD_STATUS_LABELS,
  type LeadRequestService,
  type LeadStatus,
  type SubmitResult,
} from './service'

const memoryStore = globalThis as typeof globalThis & {
  __turdusLeads?: ReturnType<typeof memoryLeadStore>
}

let service: Promise<LeadRequestService> | undefined

/**
 * Заявки на корпоративы в PostgreSQL (соединение Payload). Только сервер: форма на сайте
 * пользуется `@/modules/leads` (проверка полей), этот модуль — только `POST /api/leads`.
 * Разработка без базы: ACCOUNTS_STORE=memory (общий флаг «без базы»); в production не работает.
 */
export function getLeadRequests() {
  service ??= (async () => {
    if (process.env.NODE_ENV !== 'production' && process.env.ACCOUNTS_STORE === 'memory')
      return createLeadRequestService({ store: (memoryStore.__turdusLeads ??= memoryLeadStore()) })
    const payload = await getPayload({ config })
    const db = payload.db.drizzle as unknown as Parameters<typeof pgLeadStore>[0]
    return createLeadRequestService({ store: pgLeadStore(db) })
  })()
  // Не запоминаем неудачу (база была недоступна) — следующий запрос попробует снова.
  service.catch(() => {
    service = undefined
  })
  return service
}
