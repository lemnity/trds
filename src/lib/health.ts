export type HealthCheck = () => Promise<void>
export type CheckStatus = 'ok' | 'error'
export type HealthResult = {
  /** error — сломана обязательная проверка (503); degraded — только дополнительная (200). */
  status: 'ok' | 'degraded' | 'error'
  checks: Record<string, CheckStatus>
}

const withTimeout = (check: HealthCheck, timeoutMs: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('health check timed out')), timeoutMs)
  })
  return Promise.race([check(), timeout]).finally(() => clearTimeout(timer))
}

const runChecks = (checks: Record<string, HealthCheck>, timeoutMs: number) =>
  Promise.all(
    Object.entries(checks).map(async ([name, check]): Promise<[string, CheckStatus]> => {
      try {
        await withTimeout(check, timeoutMs)
        return [name, 'ok']
      } catch {
        return [name, 'error']
      }
    }),
  )

/**
 * Запускает проверки параллельно. Наружу отдаёт только статусы:
 * текст ошибки может содержать хосты, пользователей БД и другие детали (rules.md §6).
 *
 * `optional` — проверки, без которых сайт работает (heartbeat worker, свежесть бэкапа): их отказ
 * даёт `degraded`, а не 503, чтобы healthcheck контейнера app не зависел от соседних сервисов.
 */
export const checkHealth = async (
  checks: Record<string, HealthCheck>,
  timeoutMs: number,
  optional: Record<string, HealthCheck> = {},
): Promise<HealthResult> => {
  const [required, extra] = await Promise.all([
    runChecks(checks, timeoutMs),
    runChecks(optional, timeoutMs),
  ])
  const ok = (entries: [string, CheckStatus][]) => entries.every(([, s]) => s === 'ok')
  const status = !ok(required) ? 'error' : ok(extra) ? 'ok' : 'degraded'
  return { status, checks: Object.fromEntries([...required, ...extra]) }
}
