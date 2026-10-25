import {
  leadCreatedEmail,
  PermanentOutboxError,
  type EmailProvider,
  type OutboxHandler,
} from '@/modules/email'
import { LEAD_FORMATS } from '@/modules/leads'

import { LEAD_CREATED_KIND } from './service'

/**
 * Обработчик outbox `lead.created` (T-034, T-065): письмо театру о новой заявке. Событие пишется
 * в одной транзакции с заявкой (service.ts); доставку, повторы и dead-letter ведёт общий
 * процессор `@/modules/email/outbox`. Идемпотентность: одно событие на заявку (dedupe_key
 * `lead.created:<id>`), Message-ID письма стабилен — повтор после сбоя почта считает тем же письмом.
 * В письме и логах нет контактов заявителя: обработчик читает только формат, дату и гостей.
 */

export type LeadNotice = {
  id: string
  format: string
  eventDate: string | null
  guests: number | null
  duplicate: boolean
  createdAt: Date
}

const formatLabel = (id: string) => LEAD_FORMATS.find((f) => f.id === id)?.label ?? 'Заявка'

export function leadNotificationHandlers({
  lookup,
  provider,
  siteUrl,
  theatreEmail,
}: {
  lookup: (id: string) => Promise<LeadNotice | null>
  provider: EmailProvider
  siteUrl: string
  /** THEATRE_NOTIFY_EMAIL. Не задан — обработчика нет: события ждут в очереди (сигналит монитор). */
  theatreEmail: string | null
}): Record<string, OutboxHandler> {
  if (!theatreEmail) return {}
  return {
    [LEAD_CREATED_KIND]: async (item) => {
      const raw = item.payload.leadId ?? item.aggregateId
      const id = typeof raw === 'string' ? raw : ''
      const lead = id ? await lookup(id) : null
      // Заявку удалили до отправки (запрос на удаление ПД) — сообщать не о чем.
      if (!lead) throw new PermanentOutboxError('LEAD_NOT_FOUND')
      await provider.send({
        to: theatreEmail,
        ...leadCreatedEmail({
          formatLabel: formatLabel(lead.format),
          eventDate: lead.eventDate,
          guests: lead.guests,
          duplicate: lead.duplicate,
          boardUrl: `${siteUrl}/admin/leads`,
        }),
        idempotencyKey: item.dedupeKey,
      })
    },
  }
}
