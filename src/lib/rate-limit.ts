/**
 * Ограничение частоты запросов в памяти процесса (скользящее окно). Подходит для одного
 * экземпляра приложения (docker compose); при нескольких — заменить на общее хранилище.
 */
export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const hits = new Map<string, number[]>()
  return {
    /** true — запрос разрешён. */
    hit(key: string, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
      if (recent.length >= limit) {
        hits.set(key, recent)
        return false
      }
      recent.push(now)
      hits.set(key, recent)
      if (hits.size > 10_000) hits.clear()
      return true
    },
  }
}
