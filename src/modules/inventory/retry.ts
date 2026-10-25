import type { CommerceStore, CommerceTx } from './store'

/** Сколько раз повторять транзакцию после deadlock/serialization failure (rules.md §3). */
export const TX_ATTEMPTS = 4

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Выполнить транзакцию с ограниченным повтором. Повторяется только ошибка, которую хранилище
 * признало безопасной для повтора (вся транзакция откатилась); остальные — сразу наружу.
 * Задержка растёт экспоненциально со случайной добавкой, чтобы соперники разошлись.
 */
export async function withRetry<T>(
  store: Pick<CommerceStore, 'transaction' | 'isRetryable'>,
  fn: (tx: CommerceTx) => Promise<T>,
  {
    attempts = TX_ATTEMPTS,
    sleep = defaultSleep,
    random = Math.random,
  }: { attempts?: number; sleep?: (ms: number) => Promise<void>; random?: () => number } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await store.transaction(fn)
    } catch (error) {
      if (attempt >= attempts || !store.isRetryable(error)) throw error
      // Только задержка, не деньги: случайность здесь допустима.
      await sleep(10 * 2 ** attempt + Math.floor(10 * random()))
    }
  }
}

/** SQLSTATE PostgreSQL: serialization_failure, deadlock_detected. Ищем по цепочке `cause`. */
export const isPgRetryable = (error: unknown): boolean => {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    const code = (e as { code?: unknown }).code
    if (code === '40001' || code === '40P01') return true
    e = (e as { cause?: unknown }).cause
  }
  return false
}
