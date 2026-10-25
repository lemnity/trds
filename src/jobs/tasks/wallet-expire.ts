import type { Logger } from '@/lib/log'
import type { WalletService } from '@/modules/wallet'

import type { Job } from '../worker'

export const WALLET_EXPIRE_EVERY_MS = 60 * 60 * 1000

/**
 * Сгорание бонусов (T-063): `WalletService.expireDue` — идемпотентна (ключ `expire:<lotId>`,
 * SKIP LOCKED), поэтому безопасна при повторе и при нескольких worker. Раз в час: срок лота —
 * год, точность до часа достаточна.
 */
export const walletExpireJob = ({
  wallet,
  log,
  now = () => new Date(),
  everyMs = WALLET_EXPIRE_EVERY_MS,
}: {
  wallet: () => Promise<Pick<WalletService, 'expireDue'>>
  log: Logger
  now?: () => Date
  everyMs?: number
}): Job => ({
  name: 'wallet.expire',
  everyMs,
  run: async () => {
    const result = await (await wallet()).expireDue(now())
    if (result.lots > 0)
      log.info('wallet.expired', {
        job: 'wallet.expire',
        lots: result.lots,
        kopecks: result.kopecks,
      })
  },
})
