import { ALERTS, errorInfo, type Logger } from '@/lib/log'

import { EmailSendError } from './types'

/**
 * Обработка outbox (T-047, ADR-005, rules.md §6). Событие записано в той же транзакции, что и
 * смена статуса заказа; здесь — только доставка внешнего эффекта (письма):
 *
 * - захват строк `FOR UPDATE SKIP LOCKED` с арендой: два worker не берут одно событие, а событие
 *   упавшего worker вернётся после окончания аренды (попытка засчитана при захвате);
 * - успех — `done`; временная ошибка — снова `pending` с экспоненциальной задержкой и jitter;
 *   постоянная ошибка или исчерпаны попытки — `dead` (ручная очередь) и сигнал ALERT_OUTBOX_STUCK;
 * - обработчик не меняет заказ и оплату: сбой почты не отменяет покупку (architecture.md §8 п.10);
 * - идемпотентность: одно событие на `dedupe_key` (уникальный индекс), завершение — условным
 *   UPDATE по номеру попытки (опоздавший worker не перезапишет чужой результат), Message-ID письма
 *   стабилен — повтор после сбоя «отправлено, но не отмечено» почта видит как то же письмо.
 */

export type OutboxItem = {
  id: string
  kind: string
  dedupeKey: string
  aggregateId: string
  payload: Record<string, unknown>
  /** Номер текущей попытки (увеличен при захвате). */
  attempts: number
  createdAt: Date
}

export interface OutboxQueue {
  /** Захватить готовые события своих видов: `processing`, attempts + 1, аренда до now + leaseMs. */
  claim(input: {
    kinds: string[]
    now: Date
    limit: number
    leaseMs: number
  }): Promise<OutboxItem[]>
  /** Условные переходы: только если строка всё ещё в этой попытке. false — её уже забрали. */
  complete(item: OutboxItem, now: Date): Promise<boolean>
  retry(item: OutboxItem, at: Date, error: string): Promise<boolean>
  bury(item: OutboxItem, now: Date, error: string): Promise<boolean>
}

export type OutboxHandler = (item: OutboxItem) => Promise<void>

/** Обработчик сообщает, что повтор бессмысленен (заказ не найден, нет билетов). */
export class PermanentOutboxError extends Error {
  constructor(readonly code: string) {
    super(`Outbox event cannot be processed: ${code}`)
    this.name = 'PermanentOutboxError'
  }
}

export const OUTBOX_RULES = {
  /** 8 попыток: 30 с, 1, 2, 4, 8, 16, 32, 60 мин — около двух часов до ручной очереди. */
  maxAttempts: 8,
  baseDelayMs: 30_000,
  maxDelayMs: 60 * 60_000,
  /** Аренда захваченного события: дольше любого таймаута отправки. */
  leaseMs: 5 * 60_000,
  /** Общий таймаут одного обработчика (SMTP имеет свои, это — страховка). */
  handlerTimeoutMs: 90_000,
  batchSize: 20,
  /** Не больше стольких пачек за запуск: задача не занимает такт worker целиком. */
  maxBatches: 5,
} as const

export type OutboxRules = { [K in keyof typeof OUTBOX_RULES]: number }

/**
 * Задержка перед попыткой `attempt + 1`: экспонента с потолком и «равным» jitter — половина
 * фиксирована, половина случайна, чтобы после сбоя провайдера worker'ы не били его залпом.
 */
export const backoffMs = (
  attempt: number,
  random: () => number = Math.random,
  rules: Pick<OutboxRules, 'baseDelayMs' | 'maxDelayMs'> = OUTBOX_RULES,
) => {
  const exp = Math.min(rules.maxDelayMs, rules.baseDelayMs * 2 ** Math.max(0, attempt - 1))
  return Math.round(exp / 2 + random() * (exp / 2))
}

/** Ошибка в `last_error` и лог: только тип и машинный код — сообщение может содержать ПД. */
const errorLabel = (error: unknown) => {
  const info = errorInfo(error)
  return (info.code ? `${info.name}:${info.code}` : info.name).slice(0, 120)
}

const isPermanent = (error: unknown) =>
  error instanceof PermanentOutboxError || (error instanceof EmailSendError && error.permanent)

class HandlerTimeoutError extends Error {
  constructor() {
    super('Outbox handler timed out')
    this.name = 'HandlerTimeoutError'
  }
}

const withTimeout = async (work: Promise<void>, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HandlerTimeoutError()), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export type OutboxRunStats = { sent: number; retried: number; dead: number; lost: number }

export function createOutboxProcessor({
  queue,
  handlers,
  log,
  now = () => new Date(),
  random = Math.random,
  rules = OUTBOX_RULES,
}: {
  queue: OutboxQueue
  handlers: Record<string, OutboxHandler>
  log: Logger
  now?: () => Date
  random?: () => number
  rules?: OutboxRules
}) {
  const kinds = Object.keys(handlers).sort()

  const bury = async (item: OutboxItem, error: string, stats: OutboxRunStats) => {
    if (await queue.bury(item, now(), error)) {
      stats.dead++
      log.alert(ALERTS.outboxStuck, {
        job: 'outbox.email',
        outboxId: item.id,
        kind: item.kind,
        attempts: item.attempts,
        error,
        deadLetter: true,
      })
    } else stats.lost++
  }

  const handle = async (item: OutboxItem, stats: OutboxRunStats) => {
    // Событие уже исчерпало попытки (worker падал во время отправки) — не отправляем снова.
    if (item.attempts > rules.maxAttempts) return bury(item, 'MaxAttemptsExceeded', stats)
    const handler = handlers[item.kind]
    if (!handler) return bury(item, 'NoHandler', stats)
    try {
      await withTimeout(handler(item), rules.handlerTimeoutMs)
    } catch (error) {
      const label = errorLabel(error)
      if (isPermanent(error) || item.attempts >= rules.maxAttempts) return bury(item, label, stats)
      const at = new Date(now().getTime() + backoffMs(item.attempts, random, rules))
      if (await queue.retry(item, at, label)) {
        stats.retried++
        log.warn('outbox.retry_scheduled', {
          outboxId: item.id,
          kind: item.kind,
          attempts: item.attempts,
          nextAttemptAt: at.toISOString(),
          error: label,
        })
      } else stats.lost++
      return
    }
    if (await queue.complete(item, now())) {
      stats.sent++
      log.info('outbox.delivered', { outboxId: item.id, kind: item.kind, attempts: item.attempts })
    } else {
      // Аренда истекла и событие взял другой worker: письмо может уйти повторно (тот же Message-ID).
      stats.lost++
      log.warn('outbox.lease_lost', { outboxId: item.id, kind: item.kind })
    }
  }

  /** Один проход: несколько пачек, события пачки — последовательно (не перегружать SMTP). */
  async function runOnce(): Promise<OutboxRunStats> {
    const stats: OutboxRunStats = { sent: 0, retried: 0, dead: 0, lost: 0 }
    if (!kinds.length) return stats
    for (let batch = 0; batch < rules.maxBatches; batch++) {
      const items = await queue.claim({
        kinds,
        now: now(),
        limit: rules.batchSize,
        leaseMs: rules.leaseMs,
      })
      for (const item of items) await handle(item, stats)
      if (items.length < rules.batchSize) break
    }
    return stats
  }

  return { kinds, runOnce }
}

export type OutboxProcessor = ReturnType<typeof createOutboxProcessor>
