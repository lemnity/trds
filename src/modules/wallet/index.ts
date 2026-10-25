import config from '@payload-config'
import { createHmac } from 'node:crypto'
import { getPayload } from 'payload'

import { pgWalletStore } from './pgStore'
import { createWalletService, memoryWalletStore, type WalletService } from './service'
export { attachReferralOnSignup, type SignupReferralOutcome } from './signup'

export {
  HISTORY_LIMIT,
  MAX_CERTIFICATES_PER_BATCH,
  type ActivateResult,
  type AttachResult,
  type EarlierRefund,
  type LedgerKind,
  type RefundCompensation,
  type SpendResult,
  type UnqualifyResult,
  type WalletService,
  type WalletSummary,
} from './service'

const memoryStore = globalThis as typeof globalThis & {
  __turdusWallet?: ReturnType<typeof memoryWalletStore>
}

/** Секрет хешей номеров сертификатов — из PAYLOAD_SECRET отдельной меткой (как секрет кодов входа). */
const certificateSecret = () =>
  createHmac('sha256', process.env.PAYLOAD_SECRET || (isMemory() ? 'dev' : ''))
    .update('turdus:certificate')
    .digest('hex')

const isMemory = () =>
  process.env.NODE_ENV !== 'production' && process.env.ACCOUNTS_STORE === 'memory'

let service: Promise<WalletService> | undefined

/**
 * Бонусный кошелёк на PostgreSQL (соединение Payload). Разработка без базы: ACCOUNTS_STORE=memory
 * (тот же флаг, что у кабинета — покупатели тоже в памяти); в production не работает.
 */
export function getWallet() {
  service ??= (async () => {
    if (isMemory())
      return createWalletService({
        // Один экземпляр на процесс: API-маршруты и страницы Next собирает отдельными модулями.
        store: (memoryStore.__turdusWallet ??= memoryWalletStore()),
        secret: certificateSecret(),
      })
    if (!process.env.PAYLOAD_SECRET) throw new Error('PAYLOAD_SECRET is not set')
    const payload = await getPayload({ config })
    const db = payload.db.drizzle as unknown as Parameters<typeof pgWalletStore>[0]
    return createWalletService({ store: pgWalletStore(db), secret: certificateSecret() })
  })()
  // Не запоминаем неудачу (база была недоступна) — следующий запрос попробует снова.
  service.catch(() => {
    service = undefined
  })
  return service
}
