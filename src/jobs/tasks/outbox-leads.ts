import type { Logger } from '@/lib/log'
import {
  createEmailProvider,
  createOutboxProcessor,
  emailConfigFromEnv,
  siteUrlFromEnv,
  type OutboxProcessor,
} from '@/modules/email'
import { pgOutboxQueue } from '@/modules/email/pgOutbox'
import { leadNotificationHandlers } from '@/modules/lead-requests/notifications'
import { pgLeadNoticeLookup } from '@/modules/lead-requests/pgStore'

import type { Job } from '../worker'
import type { SqlExecutor } from './types'

/**
 * Письма театру о новых заявках на корпоратив (outbox `lead.created`, T-034/T-065). Очередь та же
 * (`commerce_outbox`), процессор свой: захватывает только события этого вида, поэтому не мешает
 * письмам с билетами (outbox-email.ts). Запуск — каждый такт worker.
 */
export const outboxLeadsJob = ({
  processor,
  log,
}: {
  processor: () => Promise<OutboxProcessor>
  log: Logger
}): Job => ({
  name: 'outbox.leads',
  run: async () => {
    const stats = await (await processor()).runOnce()
    if (stats.sent || stats.retried || stats.dead || stats.lost)
      log.info('outbox.leads_run', { job: 'outbox.leads', ...stats })
  },
})

/**
 * Сборка из окружения. Нет SMTP или THEATRE_NOTIFY_EMAIL — задачи нет (warn в лог): события
 * остаются `pending` и уйдут после настройки, outbox.monitor сигналит о зависших.
 */
export function leadOutboxJobs({
  db,
  log,
  env = process.env,
}: {
  db: unknown
  log: Logger
  env?: Record<string, string | undefined>
}): Job[] {
  const config = emailConfigFromEnv(env, { dev: env.NODE_ENV === 'development' })
  const theatreEmail = env.THEATRE_NOTIFY_EMAIL?.trim() || null
  if (config.provider !== 'smtp' || !theatreEmail) {
    log.warn('outbox.leads_disabled', {
      job: 'outbox.leads',
      provider: config.provider,
      missing: [
        ...(config.provider === 'none' ? config.missing : []),
        ...(theatreEmail ? [] : ['THEATRE_NOTIFY_EMAIL']),
      ],
    })
    return []
  }
  const processor = createOutboxProcessor({
    queue: pgOutboxQueue(db as SqlExecutor),
    handlers: leadNotificationHandlers({
      lookup: pgLeadNoticeLookup(db as Parameters<typeof pgLeadNoticeLookup>[0]),
      provider: createEmailProvider(config),
      siteUrl: siteUrlFromEnv(env),
      theatreEmail,
    }),
    log: log.child({ job: 'outbox.leads' }),
  })
  log.info('outbox.leads_enabled', { job: 'outbox.leads', kinds: processor.kinds })
  return [outboxLeadsJob({ processor: async () => processor, log })]
}
