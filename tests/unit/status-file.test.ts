import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { backupStatusCheck, workerHeartbeatCheck, writeStatusFile } from '../../src/lib/status-file'

// T-015: heartbeat worker и итог бэкапа — файлы на общем томе, их читает /api/health.
const dir = mkdtempSync(path.join(tmpdir(), 'trds-status-'))
const file = (name: string) => path.join(dir, name)
const NOW = new Date('2026-10-25T12:00:00Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

describe('writeStatusFile', () => {
  it('writes JSON atomically', async () => {
    await writeStatusFile(file('hb.json'), { at: NOW.toISOString() })
    expect(JSON.parse(readFileSync(file('hb.json'), 'utf8'))).toEqual({ at: NOW.toISOString() })
  })
})

describe('workerHeartbeatCheck', () => {
  it('passes for a fresh heartbeat and fails for a stale or missing one', async () => {
    writeFileSync(file('fresh.json'), JSON.stringify({ at: minutesAgo(5) }))
    writeFileSync(file('stale.json'), JSON.stringify({ at: minutesAgo(20) }))
    writeFileSync(file('broken.json'), '{not json')
    const check = (name: string) => workerHeartbeatCheck(file(name), 15 * 60_000, () => NOW)()
    await expect(check('fresh.json')).resolves.toBeUndefined()
    await expect(check('stale.json')).rejects.toThrow()
    await expect(check('missing.json')).rejects.toThrow()
    await expect(check('broken.json')).rejects.toThrow()
  })
})

describe('backupStatusCheck', () => {
  const day = 24 * 60
  it('fails when the last backup failed even if an older one succeeded', async () => {
    writeFileSync(
      file('b1.json'),
      JSON.stringify({ status: 'failed', at: minutesAgo(1), lastSuccessAt: minutesAgo(60) }),
    )
    await expect(backupStatusCheck(file('b1.json'), 26 * 3600_000, () => NOW)()).rejects.toThrow()
  })

  it('fails when the last successful backup is older than the limit', async () => {
    writeFileSync(
      file('b2.json'),
      JSON.stringify({ status: 'ok', at: minutesAgo(2 * day), lastSuccessAt: minutesAgo(2 * day) }),
    )
    await expect(backupStatusCheck(file('b2.json'), 26 * 3600_000, () => NOW)()).rejects.toThrow()
  })

  it('passes for a recent successful backup', async () => {
    writeFileSync(
      file('b3.json'),
      JSON.stringify({ status: 'ok', at: minutesAgo(60), lastSuccessAt: minutesAgo(60) }),
    )
    await expect(
      backupStatusCheck(file('b3.json'), 26 * 3600_000, () => NOW)(),
    ).resolves.toBeUndefined()
  })
})
