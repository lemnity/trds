import { createHash } from 'node:crypto'

import { sql, type SQL } from '@payloadcms/db-postgres/drizzle'

import { errorInfo, log } from './log'

/**
 * Ограничение частоты запросов в памяти процесса (скользящее окно). Подходит для одного
 * экземпляра приложения и для тестов. Маршрутам — `sharedRateLimiter` ниже: он держит лимит
 * в PostgreSQL, общий для всех экземпляров, и сам падает на этот вариант без базы.
 */
export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const hits = new Map<string, number[]>()
  return {
    /** Проверить без учёта попытки: true — лимит ещё не исчерпан (для счёта только неудач). */
    allowed(key: string, now = Date.now()) {
      return (hits.get(key) ?? []).filter((t) => now - t < windowMs).length < limit
    },
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

/** Общий лимитер (T-050): тот же смысл, что у `createRateLimiter`, но асинхронный. */
export type RateLimiter = {
  /** true — запрос разрешён и засчитан. */
  hit(key: string, now?: number): Promise<boolean>
  /** Проверить без учёта попытки (для счёта только неудач). */
  allowed(key: string, now?: number): Promise<boolean>
}

/** Хранилище счётчиков фиксированного окна (PostgreSQL; в тестах — подделка). */
export type RateLimitStore = {
  /** Атомарно +1, только если в окне меньше `limit`. true — попытка засчитана. */
  increment(input: {
    bucket: string
    keyHash: string
    windowStart: Date
    expiresAt: Date
    limit: number
  }): Promise<boolean>
  count(keyHash: string, windowStart: Date): Promise<number>
}

type Executor = {
  execute: (query: SQL) => Promise<{ rows: Record<string, unknown>[] }>
}

/**
 * Счётчики в `ops_rate_limits` (src/db/schema/ops.ts). Один оператор upsert: вставка окна или +1
 * при условии `hits < limit` — параллельные запросы с разных экземпляров не превысят лимит.
 * Окно фиксированное: на стыке двух окон возможен всплеск до 2× лимита — для защиты от перебора
 * этого достаточно, а запрос остаётся одним коротким оператором без блокировок.
 */
export function pgRateLimitStore(db: Executor): RateLimitStore {
  return {
    async increment({ bucket, keyHash, windowStart, expiresAt, limit }) {
      const result = await db.execute(sql`
        insert into ops_rate_limits (key_hash, window_start, bucket, hits, expires_at)
        values (${keyHash}, ${windowStart.toISOString()}::timestamptz, ${bucket}, 1,
                ${expiresAt.toISOString()}::timestamptz)
        on conflict (key_hash, window_start)
          do update set hits = ops_rate_limits.hits + 1
          where ops_rate_limits.hits < ${limit}
        returning hits`)
      return result.rows.length === 1
    },
    async count(keyHash, windowStart) {
      const result = await db.execute(sql`
        select hits from ops_rate_limits
        where key_hash = ${keyHash} and window_start = ${windowStart.toISOString()}::timestamptz`)
      return Number(result.rows[0]?.hits ?? 0)
    },
  }
}

/**
 * Без базы (тесты, `pnpm dev` с ACCOUNTS_STORE=memory) — память процесса. В production память
 * не выбирается переменной: только при отсутствии DATABASE_URL (тогда и вход не работает).
 */
const memoryMode = () =>
  process.env.NODE_ENV === 'test' ||
  Boolean(process.env.VITEST) ||
  !process.env.DATABASE_URL ||
  (process.env.NODE_ENV !== 'production' &&
    (process.env.ACCOUNTS_STORE === 'memory' || process.env.RATE_LIMIT_STORE === 'memory'))

let defaultStore: Promise<RateLimitStore | null> | undefined

/** Хранилище по умолчанию: соединение Payload (тот же пул, что у остальных доменных таблиц). */
const resolveDefaultStore = () => {
  defaultStore ??= (async () => {
    if (memoryMode()) return null
    const [{ getPayload }, { default: config }] = await Promise.all([
      import('payload'),
      import('@payload-config'),
    ])
    const payload = await getPayload({ config })
    return pgRateLimitStore(payload.db.drizzle as unknown as Executor)
  })()
  // Не запоминаем неудачу (база не поднялась) — следующий запрос попробует снова.
  defaultStore.catch(() => {
    defaultStore = undefined
  })
  return defaultStore
}

/**
 * Лимитер маршрута. `name` — уникальное имя лимита (`auth.password.ip`): с ним хешируется ключ,
 * так что разные лимиты с одним IP не мешают друг другу. База недоступна — лимит считается
 * в памяти этого экземпляра (защита слабее, но вход не блокируется из-за сбоя счётчика).
 */
export function sharedRateLimiter({
  name,
  limit,
  windowMs,
  store = resolveDefaultStore,
}: {
  name: string
  limit: number
  windowMs: number
  store?: () => Promise<RateLimitStore | null>
}): RateLimiter {
  const local = createRateLimiter({ limit, windowMs })
  const keyHash = (key: string) => createHash('sha256').update(`${name}\0${key}`).digest('hex')
  const windowOf = (now: number) => new Date(Math.floor(now / windowMs) * windowMs)

  const backend = async () => {
    try {
      return await store()
    } catch (error) {
      log.warn('rate_limit.store_unavailable', { bucket: name, error: errorInfo(error) })
      return null
    }
  }

  return {
    async hit(key, now = Date.now()) {
      const pg = await backend()
      if (!pg) return local.hit(key, now)
      const windowStart = windowOf(now)
      try {
        return await pg.increment({
          bucket: name,
          keyHash: keyHash(key),
          windowStart,
          expiresAt: new Date(windowStart.getTime() + windowMs),
          limit,
        })
      } catch (error) {
        log.warn('rate_limit.store_failed', { bucket: name, error: errorInfo(error) })
        return local.hit(key, now)
      }
    },
    async allowed(key, now = Date.now()) {
      const pg = await backend()
      if (!pg) return local.allowed(key, now)
      try {
        return (await pg.count(keyHash(key), windowOf(now))) < limit
      } catch (error) {
        log.warn('rate_limit.store_failed', { bucket: name, error: errorInfo(error) })
        return local.allowed(key, now)
      }
    },
  }
}
