import { assertServerEnv } from '../lib/env'
import { runWorker, type Job } from './worker'

assertServerEnv()

// Точка входа контейнера worker. Задачи (outbox, expiry, reconciliation, бонусы)
// подключаются по мере реализации T-045/T-047/T-048/T-063.
const jobs: Job[] = []

const DEFAULT_TICK_MS = 5 * 60 * 1000
const tickMs = Number(process.env.WORKER_TICK_MS ?? DEFAULT_TICK_MS)
if (!Number.isInteger(tickMs) || tickMs < 1000) {
  process.stderr.write('WORKER_TICK_MS must be an integer >= 1000\n')
  process.exit(1)
}

const controller = new AbortController()
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => controller.abort())
}

await runWorker({
  jobs,
  tickMs,
  signal: controller.signal,
  log: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
})
