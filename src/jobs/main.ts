import { createHmac } from 'node:crypto'

import { drizzle } from '@payloadcms/db-postgres/drizzle/node-postgres'

import { assertServerEnv } from '../lib/env'
import { ALERTS, createLogger } from '../lib/log'
import { writeStatusFile } from '../lib/status-file'
import { pgWalletStore } from '../modules/wallet/pgStore'
import { createWalletService } from '../modules/wallet/service'
import { accountsCleanupJob } from './tasks/accounts-cleanup'
import { emailOutboxJobs } from './tasks/outbox-email'
import { leadOutboxJobs } from './tasks/outbox-leads'
import { outboxMonitorJob } from './tasks/outbox-monitor'
import { paymentsReconcileJob, workerPurchase } from './tasks/payments-reconcile'
import { refundsReconcileJob, workerRefunds } from './tasks/refunds-reconcile'
import { walletExpireJob } from './tasks/wallet-expire'
import { runWorker, type Job } from './worker'

const env = assertServerEnv()
if (!env) process.exit(1)

const log = createLogger({ base: { service: 'worker' } })

// Своё небольшое соединение drizzle, без инициализации Payload: worker не нужен CMS, а бандл
// (esbuild, Dockerfile) остаётся маленьким. Таблицы — те же схемы src/db/schema.
const db = drizzle({
  connection: {
    connectionString: env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    application_name: 'trds-worker',
  },
})

// Тот же секрет, что у getWallet() (src/modules/wallet/index.ts): HMAC от PAYLOAD_SECRET
// с меткой 'turdus:certificate'. Сгоранию он не нужен, но сервис един для всех операций.
const wallet = createWalletService({
  store: pgWalletStore(db as unknown as Parameters<typeof pgWalletStore>[0]),
  secret: createHmac('sha256', env.PAYLOAD_SECRET).update('turdus:certificate').digest('hex'),
})

// Задачи — идемпотентные, каждая со своим расписанием (src/jobs/tasks). Новые (outbox, expiry
// броней, reconciliation) подключаются по мере реализации T-045/T-047/T-048.
const jobs: Job[] = [
  walletExpireJob({ wallet: async () => wallet, log }),
  accountsCleanupJob({ db: async () => db, log }),
  outboxMonitorJob({ db: async () => db, log }),
  // Сверка платежей, истечение броней, компенсация/начисление бонусов (T-045, T-048).
  paymentsReconcileJob({
    purchase: workerPurchase({ db, wallet, secret: env.PAYLOAD_SECRET, log }),
    log,
  }),
  // Возвраты: повтор с тем же ключом банка, статус «в обработке», компенсация бонусов (T-052/T-064).
  refundsReconcileJob({ refunds: workerRefunds({ db, wallet, log }), log }),
  // Письма из outbox (T-047): только при настроенной почте (EMAIL_PROVIDER=smtp).
  ...emailOutboxJobs({ db, log }),
  // Письма театру о новых заявках на корпоратив (outbox lead.created, T-034/T-065).
  ...leadOutboxJobs({ db, log }),
]

const DEFAULT_TICK_MS = 5 * 60 * 1000
const tickMs = Number(process.env.WORKER_TICK_MS ?? DEFAULT_TICK_MS)
if (!Number.isInteger(tickMs) || tickMs < 1000) {
  process.stderr.write('WORKER_TICK_MS must be an integer >= 1000\n')
  process.exit(1)
}

// Файл heartbeat на общем томе — его читает /api/health (WORKER_HEARTBEAT_FILE у app).
const heartbeatFile = process.env.WORKER_HEARTBEAT_FILE

const controller = new AbortController()
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => controller.abort())
}

await runWorker({
  jobs,
  tickMs,
  signal: controller.signal,
  log: (e) => {
    if (e.event === 'worker.job_failed') log.alert(ALERTS.jobFailed, { job: e.job, error: e.error })
    else if (e.event === 'worker.heartbeat_failed') log.warn(e.event, { error: e.error })
    else {
      const { event, ...fields } = e
      log.info(event, fields)
    }
  },
  onHeartbeat: heartbeatFile
    ? (state) => writeStatusFile(heartbeatFile, { ...state, tickMs })
    : undefined,
})
await db.$client.end()
