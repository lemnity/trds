export type HealthCheck = () => Promise<void>
export type CheckStatus = 'ok' | 'error'
export type HealthResult = {
  status: CheckStatus
  checks: Record<string, CheckStatus>
}

const withTimeout = (check: HealthCheck, timeoutMs: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('health check timed out')), timeoutMs)
  })
  return Promise.race([check(), timeout]).finally(() => clearTimeout(timer))
}

/**
 * Запускает проверки параллельно. Наружу отдаёт только статусы:
 * текст ошибки может содержать хосты, пользователей БД и другие детали (rules.md §6).
 */
export const checkHealth = async (
  checks: Record<string, HealthCheck>,
  timeoutMs: number,
): Promise<HealthResult> => {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]): Promise<[string, CheckStatus]> => {
      try {
        await withTimeout(check, timeoutMs)
        return [name, 'ok']
      } catch {
        return [name, 'error']
      }
    }),
  )
  const results = Object.fromEntries(entries)
  const status = entries.every(([, s]) => s === 'ok') ? 'ok' : 'error'
  return { status, checks: results }
}
