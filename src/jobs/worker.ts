export type Job = {
  name: string
  run: () => Promise<void>
}

export type WorkerEvent =
  | { event: 'worker.started'; jobs: string[]; tickMs: number }
  | { event: 'worker.heartbeat'; at: string }
  | { event: 'worker.job_failed'; job: string; error: string }
  | { event: 'worker.stopped' }

type WorkerOptions = {
  jobs: Job[]
  tickMs: number
  signal: AbortSignal
  log: (event: WorkerEvent) => void
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

/**
 * Цикл фоновых задач (architecture.md §12). Задачи обязаны быть идемпотентными:
 * worker не гарантирует запуск ровно один раз. Ошибка одной задачи не останавливает остальные;
 * в лог попадает только тип ошибки — сообщение может содержать ПД или секреты.
 */
export const runWorker = async ({ jobs, tickMs, signal, log }: WorkerOptions) => {
  log({ event: 'worker.started', jobs: jobs.map((j) => j.name), tickMs })
  while (!signal.aborted) {
    for (const job of jobs) {
      if (signal.aborted) break
      try {
        await job.run()
      } catch (error) {
        log({
          event: 'worker.job_failed',
          job: job.name,
          error: error instanceof Error ? error.name : 'UnknownError',
        })
      }
    }
    log({ event: 'worker.heartbeat', at: new Date().toISOString() })
    await sleep(tickMs, signal)
  }
  log({ event: 'worker.stopped' })
}
