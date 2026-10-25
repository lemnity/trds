import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres'
import { getPayload } from 'payload'

import { withCorrelation } from '@/lib/correlation'
import { checkHealth, type HealthCheck } from '@/lib/health'
import { ALERTS, type AlertCode } from '@/lib/log'
import { backupStatusCheck, workerHeartbeatCheck } from '@/lib/status-file'

export const dynamic = 'force-dynamic'

const CHECK_TIMEOUT_MS = 2000
const DEFAULT_WORKER_MAX_AGE_MS = 15 * 60 * 1000
const DEFAULT_BACKUP_MAX_AGE_HOURS = 26
// Healthcheck контейнера опрашивает маршрут каждые 15 с — сигнал в лог не чаще раза в 15 минут.
const ALERT_EVERY_MS = 15 * 60 * 1000

const positive = (raw: string | undefined, fallback: number) => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * Дополнительные проверки включаются переменными (в compose — общий том ops-state):
 * WORKER_HEARTBEAT_FILE и BACKUP_STATUS_FILE. Без них (pnpm dev) проверяется только БД.
 */
const optionalChecks = (): Record<string, HealthCheck> => {
  const checks: Record<string, HealthCheck> = {}
  const heartbeat = process.env.WORKER_HEARTBEAT_FILE
  if (heartbeat)
    checks.worker = workerHeartbeatCheck(
      heartbeat,
      positive(process.env.WORKER_HEARTBEAT_MAX_AGE_MS, DEFAULT_WORKER_MAX_AGE_MS),
    )
  const backup = process.env.BACKUP_STATUS_FILE
  if (backup)
    checks.backup = backupStatusCheck(
      backup,
      positive(process.env.BACKUP_MAX_AGE_HOURS, DEFAULT_BACKUP_MAX_AGE_HOURS) * 3600 * 1000,
    )
  return checks
}

const lastAlertAt = new Map<AlertCode, number>()
const throttled = (code: AlertCode) => {
  const now = Date.now()
  if (now - (lastAlertAt.get(code) ?? 0) < ALERT_EVERY_MS) return false
  lastAlertAt.set(code, now)
  return true
}

export const GET = withCorrelation('health', async (_req: Request, { log }) => {
  const result = await checkHealth(
    {
      database: async () => {
        const payload = await getPayload({ config })
        await payload.db.drizzle.execute(sql`select 1`)
      },
    },
    CHECK_TIMEOUT_MS,
    optionalChecks(),
  )
  if (result.checks.worker === 'error' && throttled(ALERTS.workerStale))
    log.alert(ALERTS.workerStale)
  if (result.checks.backup === 'error' && throttled(ALERTS.backupFailed))
    log.alert(ALERTS.backupFailed, { source: 'health' })
  if (result.checks.database === 'error') log.error('health.database_unavailable')
  return Response.json(result, {
    status: result.status === 'error' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  })
})
