import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRateLimiter, sharedRateLimiter, type RateLimitStore } from '../../src/lib/rate-limit'

// Ограничение частоты (T-050): общий лимитер — тот же смысл, что у памяти процесса; хранилище
// фиксированного окна подменяется, сбой хранилища не блокирует вход.

/** Хранилище как в PostgreSQL (фиксированное окно, условный +1), но в памяти — несколько «экземпляров» делят его. */
const fixedWindowStore = () => {
  const rows = new Map<string, number>()
  const store: RateLimitStore & { rows: typeof rows } = {
    rows,
    async increment({ keyHash, windowStart, limit }) {
      const id = `${keyHash}@${windowStart.toISOString()}`
      const hits = rows.get(id) ?? 0
      if (hits >= limit) return false
      rows.set(id, hits + 1)
      return true
    },
    async count(keyHash, windowStart) {
      return rows.get(`${keyHash}@${windowStart.toISOString()}`) ?? 0
    },
  }
  return store
}

afterEach(() => vi.restoreAllMocks())

describe('createRateLimiter (memory)', () => {
  it('allows up to the limit per key within the window', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000 })
    expect([limiter.hit('a', 0), limiter.hit('a', 10), limiter.hit('a', 20)]).toEqual([
      true,
      true,
      false,
    ])
    expect(limiter.hit('b', 20)).toBe(true)
    expect(limiter.hit('a', 1011)).toBe(true)
  })
})

describe('sharedRateLimiter', () => {
  it('falls back to process memory without a database (tests, dev)', async () => {
    const limiter = sharedRateLimiter({ name: 't.mem', limit: 2, windowMs: 60_000 })
    expect(await limiter.hit('ip')).toBe(true)
    expect(await limiter.hit('ip')).toBe(true)
    expect(await limiter.hit('ip')).toBe(false)
    expect(await limiter.allowed('ip')).toBe(false)
    expect(await limiter.allowed('other')).toBe(true)
  })

  it('shares the count between instances through the store', async () => {
    const store = fixedWindowStore()
    const make = () =>
      sharedRateLimiter({ name: 't.shared', limit: 5, windowMs: 60_000, store: async () => store })
    const instances = [make(), make(), make()]
    const now = 1_000_000
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => instances[i % 3]!.hit('1.2.3.4', now)),
    )
    expect(results.filter(Boolean)).toHaveLength(5)
    expect(await instances[0]!.allowed('1.2.3.4', now)).toBe(false)
    // Новое окно — снова можно.
    expect(await instances[1]!.hit('1.2.3.4', now + 60_000)).toBe(true)
  })

  it('hashes keys with the limit name: no email/IP in storage, limits do not collide', async () => {
    const store = fixedWindowStore()
    const a = sharedRateLimiter({ name: 'a', limit: 1, windowMs: 1000, store: async () => store })
    const b = sharedRateLimiter({ name: 'b', limit: 1, windowMs: 1000, store: async () => store })
    expect(await a.hit('anna@example.ru', 0)).toBe(true)
    expect(await b.hit('anna@example.ru', 0)).toBe(true)
    expect([...store.rows.keys()].join()).not.toContain('anna')
    expect([...store.rows.keys()].every((k) => /^[0-9a-f]{64}@/.test(k))).toBe(true)
  })

  it('a failing store degrades to the per-instance limit instead of blocking sign-in', async () => {
    const broken: RateLimitStore = {
      increment: async () => {
        throw new Error('connection refused')
      },
      count: async () => {
        throw new Error('connection refused')
      },
    }
    const limiter = sharedRateLimiter({
      name: 't.broken',
      limit: 1,
      windowMs: 1000,
      store: async () => broken,
    })
    expect(await limiter.hit('k', 0)).toBe(true)
    expect(await limiter.hit('k', 1)).toBe(false)
    expect(await limiter.allowed('k', 2)).toBe(false)
    const unreachable = sharedRateLimiter({
      name: 't.down',
      limit: 1,
      windowMs: 1000,
      store: async () => {
        throw new Error('db down')
      },
    })
    expect(await unreachable.hit('k', 0)).toBe(true)
    expect(await unreachable.hit('k', 1)).toBe(false)
  })
})
