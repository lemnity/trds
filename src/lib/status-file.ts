import { readFile, rename, writeFile } from 'node:fs/promises'

/**
 * Файлы состояния фоновых процессов (T-015): worker пишет heartbeat, scripts/backup.sh — итог
 * последнего бэкапа. Лежат на общем томе `ops-state` (docker-compose.yml), app читает их в
 * /api/health. Отдельная таблица не нужна: heartbeat должен быть виден и при недоступной БД.
 */

export type WorkerHeartbeat = {
  at: string
  tickMs: number
  /** Итог последнего запуска каждой задачи — без текста ошибок. */
  jobs: Record<string, { lastRunAt: string; ok: boolean }>
}

/** Атомарная запись: читатель видит либо старый, либо новый файл целиком. */
export const writeStatusFile = async (path: string, data: unknown) => {
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(data)}\n`, { mode: 0o644 })
  await rename(tmp, path)
}

const readJson = async (path: string): Promise<Record<string, unknown>> => {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!parsed || typeof parsed !== 'object') throw new Error('status file is not an object')
  return parsed as Record<string, unknown>
}

const ageMs = (value: unknown, now: Date) => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN
  if (Number.isNaN(at)) throw new Error('status file has no valid timestamp')
  return now.getTime() - at
}

/** Проверка для checkHealth: heartbeat worker не старше `maxAgeMs`. */
export const workerHeartbeatCheck =
  (path: string, maxAgeMs: number, now: () => Date = () => new Date()) =>
  async () => {
    const data = await readJson(path)
    if (ageMs(data.at, now()) > maxAgeMs) throw new Error('worker heartbeat is stale')
  }

/** Проверка для checkHealth: последний бэкап успешен и успешный не старше `maxAgeMs`. */
export const backupStatusCheck =
  (path: string, maxAgeMs: number, now: () => Date = () => new Date()) =>
  async () => {
    const data = await readJson(path)
    if (data.status !== 'ok') throw new Error('last backup failed')
    if (ageMs(data.lastSuccessAt, now()) > maxAgeMs) throw new Error('last backup is too old')
  }
