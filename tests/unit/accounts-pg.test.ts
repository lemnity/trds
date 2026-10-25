import { createRequire } from 'node:module'
import path from 'node:path'

import { sql } from '@payloadcms/db-postgres/drizzle'
import { drizzle } from '@payloadcms/db-postgres/drizzle/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { accountsTables } from '../../src/db/schema/accounts'
import { opsTables } from '../../src/db/schema/ops'
import { accountsCleanupJob } from '../../src/jobs/tasks/accounts-cleanup'
import { createLogger } from '../../src/lib/log'
import { pgRateLimitStore, sharedRateLimiter } from '../../src/lib/rate-limit'
import { pgAuthStore } from '../../src/modules/accounts/pgStore'
import { createAuthService } from '../../src/modules/accounts/service'

/**
 * Общий лимитер и привязки Яндекс ID на настоящем PostgreSQL (T-050, T-056). Запускается только
 * с ACCOUNTS_PG_URL — ОДНОРАЗОВАЯ база: схема public пересоздаётся. Например:
 *   docker run --rm -d --name trds-accounts-test -p 127.0.0.1:55434:5432 \
 *     -e POSTGRES_PASSWORD=x postgres:16.15-alpine
 *   ACCOUNTS_PG_URL=postgres://postgres:x@127.0.0.1:55434/postgres pnpm vitest run accounts-pg
 */
const url = process.env.ACCOUNTS_PG_URL

describe.skipIf(!url)('accounts and rate limits on PostgreSQL', () => {
  // Три пула — как три экземпляра приложения с общей базой.
  const pools = [0, 1, 2].map(() => drizzle({ connection: { connectionString: url!, max: 10 } }))
  const db = pools[0]!
  const quiet = createLogger({ level: 'error', write: () => undefined })

  beforeAll(async () => {
    const kit = createRequire(path.resolve('node_modules/@payloadcms/db-postgres/package.json'))(
      'drizzle-kit/api',
    ) as {
      generateDrizzleJson: (imports: Record<string, unknown>) => Promise<unknown>
      generateMigration: (prev: unknown, cur: unknown) => Promise<string[]>
    }
    const statements = await kit.generateMigration(
      await kit.generateDrizzleJson({}),
      await kit.generateDrizzleJson({ ...accountsTables, ...opsTables }),
    )
    await db.execute(sql.raw('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'))
    for (const statement of statements) await db.execute(sql.raw(statement))
  }, 60_000)

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.$client.end()))
  })

  it('schema applies cleanly: identities and rate-limit tables exist', async () => {
    const tables = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`,
    )
    expect(tables.rows.map((r) => r.table_name)).toEqual(
      [...Object.keys(accountsTables), ...Object.keys(opsTables)].sort(),
    )
  })

  it('60 parallel hits from 3 instances against a limit of 10: exactly 10 pass', async () => {
    const now = Date.UTC(2026, 10, 1, 12, 0, 0)
    const limiters = pools.map((p) =>
      sharedRateLimiter({
        name: 'pg.test',
        limit: 10,
        windowMs: 10 * 60_000,
        store: async () => pgRateLimitStore(p),
      }),
    )
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) => limiters[i % 3]!.hit('203.0.113.7', now)),
    )
    expect(results.filter(Boolean)).toHaveLength(10)
    expect(await limiters[1]!.allowed('203.0.113.7', now)).toBe(false)
    expect(await limiters[2]!.allowed('198.51.100.1', now)).toBe(true)
    const rows = await db.execute<{ hits: number; key_hash: string; bucket: string }>(
      sql`SELECT hits, key_hash, bucket FROM ops_rate_limits`,
    )
    expect(rows.rows).toEqual([
      { hits: 10, key_hash: expect.stringMatching(/^[0-9a-f]{64}$/), bucket: 'pg.test' },
    ])
    // Следующее окно — новый счёт.
    expect(await limiters[0]!.hit('203.0.113.7', now + 10 * 60_000)).toBe(true)
  })

  it('the cleanup job removes ended windows only', async () => {
    const now = new Date(Date.UTC(2026, 10, 1, 12, 15, 0))
    await accountsCleanupJob({ db: async () => db, log: quiet, now: () => now }).run()
    const left = await db.execute<{ window_start: Date }>(
      sql`SELECT window_start FROM ops_rate_limits`,
    )
    // Окно 12:00–12:10 удалено, 12:10–12:20 ещё действует.
    expect(left.rows).toHaveLength(1)
    expect(new Date(left.rows[0]!.window_start).toISOString()).toBe('2026-11-01T12:10:00.000Z')
  })

  it('one Yandex account → one customer even when two link at the same time', async () => {
    const auth = createAuthService({
      store: pgAuthStore(db as unknown as Parameters<typeof pgAuthStore>[0]),
      secret: 'otp-secret-otp-secret-otp-secret-123',
      sendCode: async () => undefined,
      randomCode: () => '123456',
    })
    const signIn = async (email: string) => {
      await auth.requestCode({ email, purpose: 'login' })
      const r = await auth.verifyCode({ email, code: '123456' })
      if (!r.ok) throw new Error('login failed')
      return r.customer.id
    }
    const a = await signIn('a@mail.ru')
    const b = await signIn('b@mail.ru')
    const profile = {
      provider: 'yandex' as const,
      subject: '777',
      email: 'y@yandex.ru',
      name: null,
    }
    const results = await Promise.all([
      auth.linkIdentity(a, profile),
      auth.linkIdentity(b, profile),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: 'taken' }])

    const owner = results[0]!.ok ? a : b
    const signedIn = await auth.externalSignIn(profile)
    expect(signedIn.ok && signedIn.customer.id).toBe(owner)
    // Второй Яндекс ID к тому же покупателю не привязать.
    expect(await auth.linkIdentity(owner, { ...profile, subject: '778' })).toEqual({
      ok: false,
      error: 'already_linked',
    })
    await auth.unlinkIdentity(owner, 'yandex')
    expect(await auth.linkedProviders(owner)).toEqual([])
  })

  it('parallel first Yandex sign-ups with one email create one customer', async () => {
    const auth = createAuthService({
      store: pgAuthStore(db as unknown as Parameters<typeof pgAuthStore>[0]),
      secret: 'otp-secret-otp-secret-otp-secret-123',
      sendCode: async () => undefined,
    })
    const profile = {
      provider: 'yandex' as const,
      subject: '900',
      email: 'new@yandex.ru',
      name: 'Новая',
    }
    const results = await Promise.all([auth.externalSignUp(profile), auth.externalSignUp(profile)])
    const ids = results.map((r) => (r.ok ? r.customer.id : null))
    expect(new Set(ids).size).toBe(1)
    expect(results.filter((r) => r.ok && r.created)).toHaveLength(1)
    const count = await db.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM accounts_customers WHERE email = 'new@yandex.ru'`,
    )
    expect(Number(count.rows[0]!.n)).toBe(1)
  })
})
