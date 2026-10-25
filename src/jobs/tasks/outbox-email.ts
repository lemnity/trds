import type { Logger } from '@/lib/log'
import {
  createEmailProvider,
  createOutboxProcessor,
  emailConfigFromEnv,
  siteUrlFromEnv,
  type OutboxProcessor,
} from '@/modules/email'
import { pgOutboxQueue } from '@/modules/email/pgOutbox'
import { getShowsData } from '@/modules/shows/source'
import { ticketNotificationHandlers } from '@/modules/tickets/notifications'
import { performanceLookupFrom } from '@/modules/tickets/performances'
import { pgTicketsStore } from '@/modules/tickets/pgStore'
import { createTicketsService } from '@/modules/tickets/service'
import { ticketSecretFrom } from '@/modules/tickets/token'

import type { Job } from '../worker'
import type { SqlExecutor } from './types'

/**
 * Отправка писем из outbox (T-047): билеты после оплаты, возвраты, ручная проверка для театра.
 * Логика очереди — `@/modules/email/outbox` (SKIP LOCKED, backoff, dead-letter + ALERT_OUTBOX_STUCK);
 * задача только запускает проход и пишет итог. Запускается каждый такт worker (WORKER_TICK_MS):
 * письмо с билетом не должно ждать часами.
 */
export const outboxEmailJob = ({
  processor,
  log,
}: {
  processor: () => Promise<OutboxProcessor>
  log: Logger
}): Job => ({
  name: 'outbox.email',
  run: async () => {
    const stats = await (await processor()).runOnce()
    if (stats.sent || stats.retried || stats.dead || stats.lost)
      log.info('outbox.email_run', { job: 'outbox.email', ...stats })
  },
})

/**
 * Сборка задачи для worker из окружения. Почта не настроена — задачи нет (warn в лог): письма
 * остаются `pending` и дождутся настройки, а outbox.monitor сигналит о зависших событиях.
 * Соединение — то же drizzle worker'а (без Payload).
 */
export function emailOutboxJobs({
  db,
  log,
  env = process.env,
}: {
  db: unknown
  log: Logger
  env?: Record<string, string | undefined>
}): Job[] {
  const config = emailConfigFromEnv(env, { dev: env.NODE_ENV === 'development' })
  // Локальный ящик dev живёт в памяти процесса приложения — worker туда не пишет.
  if (config.provider !== 'smtp') {
    log.warn('outbox.email_disabled', {
      job: 'outbox.email',
      provider: config.provider,
      missing: config.provider === 'none' ? config.missing : [],
    })
    return []
  }
  if (!env.PAYLOAD_SECRET) throw new Error('PAYLOAD_SECRET is not set')
  const store = pgTicketsStore(db as Parameters<typeof pgTicketsStore>[0])
  const performances = async () => performanceLookupFrom(await getShowsData())
  const tickets = createTicketsService({
    store,
    secret: ticketSecretFrom(env.PAYLOAD_SECRET),
    performances,
  })
  const processor = createOutboxProcessor({
    queue: pgOutboxQueue(db as SqlExecutor),
    handlers: ticketNotificationHandlers({
      store,
      tickets,
      performances,
      provider: createEmailProvider(config),
      siteUrl: siteUrlFromEnv(env),
      theatreEmail: env.THEATRE_NOTIFY_EMAIL?.trim() || null,
    }),
    log: log.child({ job: 'outbox.email' }),
  })
  log.info('outbox.email_enabled', { job: 'outbox.email', kinds: processor.kinds })
  return [outboxEmailJob({ processor: async () => processor, log })]
}
