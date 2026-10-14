import { describe, expect, it } from 'vitest'

import { checkHealth } from '../../src/lib/health'

describe('checkHealth', () => {
  it('reports ok when every check passes', async () => {
    const result = await checkHealth({ database: async () => {} }, 100)
    expect(result).toEqual({ status: 'ok', checks: { database: 'ok' } })
  })

  it('reports error without leaking the failure details', async () => {
    const result = await checkHealth(
      {
        database: async () => {
          throw new Error('password authentication failed for user "trds"')
        },
      },
      100,
    )
    expect(result).toEqual({ status: 'error', checks: { database: 'error' } })
    expect(JSON.stringify(result)).not.toContain('password')
  })

  it('treats a hanging check as an error after the timeout', async () => {
    const started = Date.now()
    const result = await checkHealth({ database: () => new Promise<void>(() => {}) }, 50)
    expect(result.checks.database).toBe('error')
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
