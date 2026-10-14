import { describe, expect, it } from 'vitest'

import { runWorker, type WorkerEvent } from '../../src/jobs/worker'

const collect = () => {
  const events: WorkerEvent[] = []
  return { events, log: (e: WorkerEvent) => events.push(e) }
}

describe('runWorker', () => {
  it('runs every job on each tick and emits a heartbeat', async () => {
    const controller = new AbortController()
    const { events, log } = collect()
    const runs: string[] = []
    const jobs = [
      { name: 'a', run: async () => void runs.push('a') },
      {
        name: 'b',
        run: async () => {
          runs.push('b')
          if (runs.length >= 4) controller.abort()
        },
      },
    ]

    await runWorker({ jobs, tickMs: 5, signal: controller.signal, log })

    expect(runs).toEqual(['a', 'b', 'a', 'b'])
    expect(events.filter((e) => e.event === 'worker.heartbeat')).toHaveLength(2)
  })

  it('keeps running other jobs when one job fails', async () => {
    const controller = new AbortController()
    const { events, log } = collect()
    const runs: string[] = []
    const jobs = [
      {
        name: 'broken',
        run: async () => {
          throw new TypeError('secret-token-value')
        },
      },
      {
        name: 'healthy',
        run: async () => {
          runs.push('healthy')
          controller.abort()
        },
      },
    ]

    await runWorker({ jobs, tickMs: 5, signal: controller.signal, log })

    expect(runs).toEqual(['healthy'])
    expect(events).toContainEqual({ event: 'worker.job_failed', job: 'broken', error: 'TypeError' })
    expect(JSON.stringify(events)).not.toContain('secret-token-value')
  })

  it('stops promptly when aborted between ticks', async () => {
    const controller = new AbortController()
    const { events, log } = collect()
    setTimeout(() => controller.abort(), 20)
    const started = Date.now()

    await runWorker({ jobs: [], tickMs: 60_000, signal: controller.signal, log })

    expect(Date.now() - started).toBeLessThan(1000)
    expect(events.at(-1)).toEqual({ event: 'worker.stopped' })
  })
})
