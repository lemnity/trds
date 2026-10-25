import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'

import { closeDb, openDb, sql } from './support/db'
import {
  CERTIFICATE_COUNT,
  CERTIFICATE_RUBLES,
  CERTIFICATES_FILE,
  E2E_DIR,
  LAST_CAPACITY,
  PERF_LAST,
  PERF_MAIN,
  ROOT,
  SERVER_LOG,
  SHOW_SLUG,
} from './support/env'

/**
 * Окружение e2e (T-070): одноразовый PostgreSQL → миграции → сид CMS → сертификаты → `next dev`
 * на свободном порту. Именно dev-сервер: учебный банк (`PAYMENT_PROVIDER=fake`) и локальный
 * почтовый ящик (`/api/dev/outbox`, коды входа) существуют только вне production.
 *
 * - `E2E_DATABASE_URL` — готовая база (CI: service postgres). Имя базы обязано содержать `e2e`:
 *   схема public пересоздаётся. Без переменной — контейнер `postgres:16.15-alpine` на случайном
 *   порту 127.0.0.1, удаляется в teardown (`E2E_KEEP_DB=1` — оставить для разбора).
 * - Сервер собирается в `.next-e2e` (NEXT_DIST_DIR) — не мешает dev-серверу разработчика в `.next`.
 * - Секреты — только тестовые, сгенерированные на прогон.
 */

const PG_IMAGE = 'postgres:16.15-alpine'

const log = (line: string) => process.stdout.write(`[e2e] ${line}\n`)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(new Error('port')),
      )
    })
  })

const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv) =>
  execFileSync(cmd, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })

type Database = { url: string; cleanup: () => void }

/** Одноразовая база: своя (контейнер) или переданная — с проверкой, что её можно стереть. */
async function startDatabase(): Promise<Database> {
  const given = process.env.E2E_DATABASE_URL
  if (given) {
    const name = new URL(given).pathname.slice(1)
    if (!name.includes('e2e'))
      throw new Error(`E2E_DATABASE_URL: база «${name}» будет стёрта — имя должно содержать e2e`)
    return { url: given, cleanup: () => {} }
  }
  const container = `trds-e2e-pg-${randomBytes(4).toString('hex')}`
  const password = randomBytes(12).toString('hex')
  run(
    'docker',
    [
      'run',
      '--rm',
      '-d',
      '--name',
      container,
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-e',
      'POSTGRES_DB=trds_e2e',
      '-p',
      '127.0.0.1::5432',
      PG_IMAGE,
    ],
    process.env,
  )
  const cleanup = () => {
    if (process.env.E2E_KEEP_DB === '1') return log(`база оставлена: контейнер ${container}`)
    try {
      run('docker', ['rm', '-f', container], process.env)
    } catch {
      // Контейнер уже удалён (--rm) — нечего чистить.
    }
  }
  try {
    const port = run('docker', ['port', container, '5432/tcp'], process.env)
      .trim()
      .split('\n')[0]!
      .split(':')
      .pop()
    // Образ при первом старте поднимает временный сервер только на сокете — ждём TCP.
    for (let i = 0; ; i++) {
      try {
        run(
          'docker',
          ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'],
          process.env,
        )
        break
      } catch {
        if (i > 60) throw new Error('PostgreSQL не поднялся за 30 с')
        await sleep(500)
      }
    }
    log(`PostgreSQL: контейнер ${container}, порт ${port}`)
    return { url: `postgres://postgres:${password}@127.0.0.1:${port}/trds_e2e`, cleanup }
  } catch (error) {
    cleanup()
    throw error
  }
}

/** Пустая схема: прогон не зависит от прошлого (повторный запуск на той же базе). */
async function resetSchema(url: string) {
  const db = openDb(url)
  try {
    for (let i = 0; ; i++) {
      try {
        await db.execute(sql`drop schema if exists public cascade`)
        await db.execute(sql`create schema public`)
        return
      } catch (error) {
        if (i > 20) throw error
        await sleep(500)
      }
    }
  } finally {
    await closeDb(db)
  }
}

/**
 * Даты демо-афиши фиксированы (октябрь–ноябрь 2026): переносим два показа в будущее от сегодня.
 * «Последние билеты» — вместимость LAST_CAPACITY и в CMS, и в остатках ядра продаж (сид уже
 * синхронизировал их хуком syncCapacity; продаж ещё нет, CHECK sold + held <= capacity выполнен).
 */
async function prepareData(url: string) {
  const db = openDb(url)
  try {
    // 19:00 по Екатеринбургу (14:00 UTC) через 30 и 37 дней.
    await db.execute(sql`
      update performances set starts_at = date_trunc('day', now()) + interval '30 days 14 hours'
      where code = ${PERF_MAIN}`)
    await db.execute(sql`
      update performances set starts_at = date_trunc('day', now()) + interval '37 days 14 hours'
      where code = ${PERF_LAST}`)
    await db.execute(sql`
      update ticket_types set capacity = ${LAST_CAPACITY}
      where performance_id = (select id from performances where code = ${PERF_LAST})`)
    const updated = await db.execute(sql`
      update commerce_inventory set capacity = ${LAST_CAPACITY}
      where performance_id = ${PERF_LAST} and sold = 0 and held = 0`)
    if (updated.rowCount !== 1) throw new Error(`остатки ${PERF_LAST} не найдены после сида`)
  } finally {
    await closeDb(db)
  }
}

async function waitForServer(url: string, server: ChildProcess) {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`next dev завершился (код ${server.exitCode})`)
    try {
      const res = await fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(60_000) })
      if (res.ok) return
    } catch {
      // Ещё не слушает или компилирует маршрут.
    }
    await sleep(1000)
  }
  throw new Error(`сервер ${url} не ответил за 3 минуты — см. ${SERVER_LOG}`)
}

/** Первая компиляция страницы в dev — секунды; прогреваем ключевые, чтобы не съесть таймауты тестов. */
async function warmUp(url: string) {
  const pages = [
    '/',
    '/afisha',
    `/shows/${SHOW_SLUG}`,
    `/checkout/${PERF_MAIN}?tickets=standard:1`,
    '/checkout/result',
    '/login',
    '/register',
    '/account',
    '/corporate',
    '/contacts',
    '/api/dev/outbox',
    '/api/auth/session',
    '/api/loyalty/summary',
    '/api/account/tickets',
  ]
  for (const page of pages)
    await fetch(new URL(page, url), { redirect: 'manual', signal: AbortSignal.timeout(120_000) })
      .then((res) => res.arrayBuffer())
      .catch(() => {})
}

export default async function globalSetup() {
  // Разработка тестов: уже поднятое этим же setup окружение (сервер и база из его лога) —
  // `E2E_BASE_URL=… E2E_DATABASE_URL=… pnpm test:e2e <файл>` без повторного сида.
  if (process.env.E2E_BASE_URL) {
    if (!process.env.E2E_DATABASE_URL) throw new Error('E2E_BASE_URL требует E2E_DATABASE_URL')
    process.env.E2E_RESOLVED_DATABASE_URL = process.env.E2E_DATABASE_URL
    log(`используется запущенный сервер ${process.env.E2E_BASE_URL}`)
    return
  }
  const started = Date.now()
  mkdirSync(E2E_DIR, { recursive: true })
  const database = await startDatabase()
  let server: ChildProcess | null = null
  // next dev переписывает next-env.d.ts под свой distDir — вернём файл разработчика в teardown.
  const nextEnvPath = path.join(ROOT, 'next-env.d.ts')
  const nextEnv = existsSync(nextEnvPath) ? readFileSync(nextEnvPath, 'utf8') : null

  const teardown = async () => {
    if (server?.pid && server.exitCode === null) {
      // Группа процессов: next dev запускает дочерний next-server.
      try {
        process.kill(-server.pid, 'SIGTERM')
      } catch {
        server.kill('SIGTERM')
      }
      await sleep(1000)
    }
    if (nextEnv !== null) writeFileSync(nextEnvPath, nextEnv)
    database.cleanup()
  }

  try {
    const secret = randomBytes(32).toString('hex')
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'development',
      DATABASE_URL: database.url,
      PAYLOAD_SECRET: secret,
      // Схему создают миграции; dev-синхронизация Payload на готовой схеме не нужна.
      PAYLOAD_MIGRATING: 'true',
      PAYMENT_PROVIDER: 'fake',
      MEDIA_DIR: path.join(E2E_DIR, 'media'),
      CONTENT_SOURCE: 'cms',
      // Номер-заглушка: баннер cookie должен решать, грузить ли Метрику (запросы перехватывает тест).
      NEXT_PUBLIC_YM_ID: '12345678',
      NEXT_DIST_DIR: '.next-e2e',
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_OPTIONS: '--no-deprecation',
      // Перекрываем .env разработчика: письма — в локальный ящик, адрес сайта — адрес запроса.
      EMAIL_PROVIDER: '',
      NEXT_PUBLIC_SITE_URL: '',
      PUBLIC_SITE_URL: '',
      ACCOUNTS_STORE: '',
      RATE_LIMIT_STORE: '',
      CHECKOUT_HOLD_TTL_SECONDS: '',
      YANDEX_CLIENT_ID: '',
      YANDEX_CLIENT_SECRET: '',
      YANDEX_REDIRECT_URI: '',
      LOG_LEVEL: 'warn',
    }

    await resetSchema(database.url)
    log('миграции…')
    run('pnpm', ['-s', 'payload', 'migrate'], env)
    log('сид CMS…')
    run('pnpm', ['-s', 'cms:seed'], env)
    await prepareData(database.url)
    rmSync(CERTIFICATES_FILE, { force: true })
    run(
      'pnpm',
      [
        '-s',
        'certificates:issue',
        `amount=${CERTIFICATE_RUBLES}`,
        `count=${CERTIFICATE_COUNT}`,
        'by=e2e',
        `out=${CERTIFICATES_FILE}`,
      ],
      env,
    )

    const port = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : await freePort()
    const url = `http://localhost:${port}`
    const out = openSync(SERVER_LOG, 'w')
    server = spawn('node_modules/.bin/next', ['dev', '--port', String(port)], {
      cwd: ROOT,
      env,
      detached: true,
      stdio: ['ignore', out, out],
    })
    closeSync(out)
    log(`next dev: ${url} (лог — ${path.relative(ROOT, SERVER_LOG)})`)
    await waitForServer(url, server)
    await warmUp(url)
    log(`готово за ${Math.round((Date.now() - started) / 1000)} с`)

    // Воркеры Playwright наследуют окружение раннера.
    process.env.E2E_BASE_URL = url
    process.env.E2E_RESOLVED_DATABASE_URL = database.url
    return teardown
  } catch (error) {
    await teardown()
    throw error
  }
}
