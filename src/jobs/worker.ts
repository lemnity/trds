export type Job = {
  name: string
  run: () => Promise<void>
  /**
   * Не чаще чем раз в столько мс (по умолчанию — каждый такт). Расписание считается от последнего
   * запуска в этом процессе: после рестарта задача выполняется сразу — она обязана быть идемпотентной.
   */
  everyMs?: number
}

export type JobState = { lastRunAt: string; ok: boolean }

export type WorkerEvent =
  | { event: 'worker.started'; jobs: string[]; tickMs: number }
  | { event: 'worker.heartbeat'; at: string }
  | { event: 'worker.job_failed'; job: string; error: string }
  | { event: 'worker.heartbeat_failed'; error: string }
  | { event: 'worker.stopped' }

type WorkerOptions = {
  jobs: Job[]
  tickMs: number
  signal: AbortSignal
  log: (event: WorkerEvent) => void
  /** Запись heartbeat наружу (файл состояния для /api/health). Ошибка записи не роняет цикл. */
  onHeartbeat?: (state: { at: string; jobs: Record<string, JobState> }) => Promise<void>
  now?: () => Date
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })

const errorName = (error: unknown) => (error instanceof Error ? error.name : 'UnknownError')

/**
 * Цикл фоновых задач (architecture.md §12). Задачи обязаны быть идемпотентными:
 * worker не гарантирует запуск ровно один раз. Ошибка одной задачи не останавливает остальные;
 * в лог попадает только тип ошибки — сообщение может содержать ПД или секреты.
 */
export const runWorker = async ({
  jobs,
  tickMs,
  signal,
  log,
  onHeartbeat,
  now = () => new Date(),
}: WorkerOptions) => {
  log({ event: 'worker.started', jobs: jobs.map((j) => j.name), tickMs })
  const state: Record<string, JobState> = {}
  const lastStarted = new Map<string, number>()
  while (!signal.aborted) {
    for (const job of jobs) {
      if (signal.aborted) break
      const startedAt = now()
      const previous = lastStarted.get(job.name)
      if (job.everyMs && previous !== undefined && startedAt.getTime() - previous < job.everyMs)
        continue
      lastStarted.set(job.name, startedAt.getTime())
      try {
        await job.run()
        state[job.name] = { lastRunAt: startedAt.toISOString(), ok: true }
      } catch (error) {
        state[job.name] = { lastRunAt: startedAt.toISOString(), ok: false }
        log({ event: 'worker.job_failed', job: job.name, error: errorName(error) })
      }
    }
    const at = now().toISOString()
    log({ event: 'worker.heartbeat', at })
    if (onHeartbeat) {
      try {
        await onHeartbeat({ at, jobs: { ...state } })
      } catch (error) {
        log({ event: 'worker.heartbeat_failed', error: errorName(error) })
      }
    }
    await sleep(tickMs, signal)
  }
  log({ event: 'worker.stopped' })
}
