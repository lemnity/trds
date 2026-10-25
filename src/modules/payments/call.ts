import { PaymentProviderError, type ProviderErrorKind } from './types'

/** Таймаут одного обращения к банку и число попыток (rules.md §6). */
export const PROVIDER_TIMEOUT_MS = 10_000
export const PROVIDER_ATTEMPTS = 3

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export type CallOptions = {
  timeoutMs?: number
  attempts?: number
  sleep?: (ms: number) => Promise<void>
  /** Сообщение об отказе (метрика: в лог — операция и вид ошибки, без данных платежа). */
  onFailure?: (failure: { attempt: number; kind: ProviderErrorKind }) => void
}

const kindOf = (error: unknown): ProviderErrorKind =>
  error instanceof PaymentProviderError
    ? error.kind
    : error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
      ? 'timeout'
      : 'unavailable'

/**
 * Вызов провайдера с таймаутом и ограниченным повтором с backoff. Повторяются только
 * `timeout`/`unavailable` — поэтому каждая изменяющая операция обязана нести ключ
 * идемпотентности (повтор с тем же ключом не создаёт второй платёж/возврат). Окончательный
 * отказ (`rejected`) не повторяется. После последней попытки — `PaymentProviderError`.
 */
export async function callProvider<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  {
    timeoutMs = PROVIDER_TIMEOUT_MS,
    attempts = PROVIDER_ATTEMPTS,
    sleep = defaultSleep,
    onFailure,
  }: CallOptions = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new PaymentProviderError('timeout', 'payment provider timeout'))
      }, timeoutMs)
    })
    try {
      return await Promise.race([fn(controller.signal), timeout])
    } catch (error) {
      const kind = kindOf(error)
      onFailure?.({ attempt, kind })
      if (kind === 'rejected' || attempt >= attempts)
        throw error instanceof PaymentProviderError
          ? error
          : new PaymentProviderError(kind, 'payment provider call failed')
      await sleep(200 * 2 ** (attempt - 1))
    } finally {
      clearTimeout(timer)
    }
  }
}
