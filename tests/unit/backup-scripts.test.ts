import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// T-014: аргументы и поведение scripts/backup.sh и scripts/restore.sh. Утилиты PostgreSQL
// подменены заглушками в PATH — настоящий прогон на БД описан в docs/runbook.md (учение T-072).
const root = path.resolve(import.meta.dirname, '../..')
const BACKUP = path.join(root, 'scripts/backup.sh')
const RESTORE = path.join(root, 'scripts/restore.sh')
const COUNTS = 'accounts_customers\t3\nwallet_ledger\t5'

const stubs = (() => {
  const bin = mkdtempSync(path.join(tmpdir(), 'trds-pgstub-'))
  const write = (name: string, body: string) => {
    writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`)
    chmodSync(path.join(bin, name), 0o755)
  }
  write(
    'psql',
    `case "$*" in
  *xpath*) printf '%b\\n' "\${STUB_COUNTS:-${COUNTS.replace(/\t/g, '\\t').replace(/\n/g, '\\n')}}" ;;
  *information_schema.tables*) echo "\${STUB_TABLES:-0}" ;;
esac`,
  )
  write(
    'pg_dump',
    `[ "$1" = "--version" ] && { echo "pg_dump (PostgreSQL) 16.15"; exit 0; }
[ "\${STUB_FAIL:-}" = pg_dump ] && { echo "pg_dump: error: connection failed" >&2; exit 1; }
for a in "$@"; do case "$a" in --file=*) echo DUMP >"\${a#--file=}" ;; esac; done`,
  )
  write('pg_restore', `[ "\${STUB_FAIL:-}" = pg_restore ] && exit 1; exit 0`)
  return bin
})()

const run = (script: string, args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    // Чистое окружение: без DATABASE_URL/PG* разработчика.
    env: { NODE_ENV: 'test', PATH: `${stubs}:${process.env.PATH}`, HOME: tmpdir(), ...env },
  })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}
const jsonLines = (text: string) =>
  text
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Record<string, unknown>)

const fresh = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'trds-backup-'))
  const media = path.join(dir, 'media')
  mkdirSync(media)
  writeFileSync(path.join(media, 'poster.webp'), 'img')
  return { dir, dest: path.join(dir, 'backups'), media, status: path.join(dir, 'status.json') }
}
const backups = (dest: string) => readdirSync(dest).filter((n) => n.startsWith('trds-'))

describe('scripts/backup.sh', () => {
  it('prints usage and rejects bad arguments', () => {
    expect(run(BACKUP, ['--help']).code).toBe(0)
    expect(run(BACKUP, ['--bogus']).code).toBe(2)
    expect(run(BACKUP, ['--retention-days', 'abc']).code).toBe(2)
    expect(run(BACKUP, ['--retention-days', '0']).code).toBe(2)
    expect(run(BACKUP, ['--media-dir', '/nonexistent-trds']).code).toBe(2)
  })

  it('creates a timestamped, checksummed backup and an ok status', () => {
    const t = fresh()
    const r = run(BACKUP, ['--dest', t.dest, '--media-dir', t.media, '--status-file', t.status])
    expect(r.code).toBe(0)
    const [name] = backups(t.dest)
    expect(name).toMatch(/^trds-\d{8}T\d{6}Z$/)
    const dir = path.join(t.dest, name!)
    expect(readdirSync(dir).sort()).toEqual([
      'SHA256SUMS',
      'counts.tsv',
      'db.dump',
      'manifest.json',
      'media.tar.gz',
    ])
    expect(readFileSync(path.join(dir, 'counts.tsv'), 'utf8').trim()).toBe(COUNTS)
    expect(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'))).toMatchObject({
      name,
      media: true,
      mediaFiles: 1,
      tables: 2,
    })
    expect(JSON.parse(readFileSync(t.status, 'utf8'))).toMatchObject({ status: 'ok', backup: name })
    expect(jsonLines(r.stdout).at(-1)).toMatchObject({ event: 'backup.done', name })
    // Временный каталог и lock не остаются.
    expect(readdirSync(t.dest).filter((n) => n.startsWith('.'))).toEqual([])
  })

  it('prunes copies older than the retention period but keeps recent ones', () => {
    const t = fresh()
    mkdirSync(t.dest, { recursive: true })
    const old = path.join(t.dest, 'trds-20200101T000000Z')
    const recent = path.join(t.dest, 'trds-20990101T000000Z')
    mkdirSync(old)
    mkdirSync(recent)
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000)
    utimesSync(old, tenDaysAgo, tenDaysAgo)
    const r = run(BACKUP, ['--dest', t.dest, '--retention-days', '7'])
    expect(r.code).toBe(0)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(recent)).toBe(true)
    expect(jsonLines(r.stdout).at(-1)).toMatchObject({ pruned: 1 })
  })

  it('fails with ALERT_BACKUP_FAILED, keeps the last success date and leaves no partial copy', () => {
    const t = fresh()
    expect(run(BACKUP, ['--dest', t.dest, '--status-file', t.status]).code).toBe(0)
    const { lastSuccessAt } = JSON.parse(readFileSync(t.status, 'utf8')) as {
      lastSuccessAt: string
    }

    const r = run(BACKUP, ['--dest', t.dest, '--status-file', t.status], { STUB_FAIL: 'pg_dump' })
    expect(r.code).toBe(1)
    expect(jsonLines(r.stderr)).toContainEqual(
      expect.objectContaining({ event: 'alert', alert: 'ALERT_BACKUP_FAILED', step: 'pg_dump' }),
    )
    expect(JSON.parse(readFileSync(t.status, 'utf8'))).toMatchObject({
      status: 'failed',
      step: 'pg_dump',
      lastSuccessAt,
    })
    expect(backups(t.dest)).toHaveLength(1)
    expect(readdirSync(t.dest).filter((n) => n.startsWith('.'))).toEqual([])
  })

  it('refuses to run while another backup holds the lock', () => {
    const t = fresh()
    mkdirSync(path.join(t.dest, '.lock'), { recursive: true })
    const r = run(BACKUP, ['--dest', t.dest])
    expect(r.code).toBe(1)
    expect(jsonLines(r.stderr)).toContainEqual(expect.objectContaining({ step: 'lock' }))
    // Чужой lock не снимаем.
    expect(existsSync(path.join(t.dest, '.lock'))).toBe(true)
  })
})

describe('scripts/restore.sh', () => {
  const backup = () => {
    const t = fresh()
    expect(run(BACKUP, ['--dest', t.dest, '--media-dir', t.media]).code).toBe(0)
    return { ...t, from: path.join(t.dest, backups(t.dest)[0]!) }
  }

  it('requires --from and a target database', () => {
    expect(run(RESTORE, ['--help']).code).toBe(0)
    expect(run(RESTORE, ['--target-db', 'trds']).code).toBe(2)
    const b = backup()
    expect(run(RESTORE, ['--from', b.from]).code).toBe(2)
    expect(run(RESTORE, ['--from', b.from, '--target-db', 'bad;name', '--yes']).code).toBe(2)
    expect(run(RESTORE, ['--from', b.dir, '--target-db', 'trds', '--yes']).code).toBe(2)
  })

  it('refuses without --yes when there is no terminal to confirm', () => {
    const b = backup()
    const r = run(RESTORE, ['--from', b.from, '--target-db', 'trds_restore'])
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('--yes')
  })

  it('refuses a damaged backup', () => {
    const b = backup()
    writeFileSync(path.join(b.from, 'db.dump'), 'tampered')
    const r = run(RESTORE, ['--from', b.from, '--target-db', 'trds_restore', '--yes'])
    expect(r.code).toBe(1)
    expect(jsonLines(r.stderr)).toContainEqual(expect.objectContaining({ step: 'checksum' }))
  })

  it('refuses a non-empty target unless --clean', () => {
    const b = backup()
    const args = ['--from', b.from, '--target-db', 'trds_restore', '--yes']
    expect(run(RESTORE, args, { STUB_TABLES: '20' }).code).toBe(2)
    expect(run(RESTORE, [...args, '--clean'], { STUB_TABLES: '20' }).code).toBe(0)
  })

  it('restores, verifies row counts and unpacks media', () => {
    const b = backup()
    const mediaDest = path.join(b.dir, 'restored-media')
    const r = run(RESTORE, [
      '--from',
      b.from,
      '--target-db',
      'trds_restore',
      '--media-dest',
      mediaDest,
      '--yes',
    ])
    expect(r.code).toBe(0)
    expect(readFileSync(path.join(mediaDest, 'poster.webp'), 'utf8')).toBe('img')
    expect(jsonLines(r.stdout)).toContainEqual(
      expect.objectContaining({ event: 'restore.counts_ok', tables: 2, rows: 8 }),
    )
  })

  it('fails when restored row counts differ from the backup', () => {
    const b = backup()
    const r = run(RESTORE, ['--from', b.from, '--target-db', 'trds_restore', '--yes'], {
      STUB_COUNTS: 'accounts_customers\\t3\\nwallet_ledger\\t4',
    })
    expect(r.code).toBe(1)
    expect(jsonLines(r.stderr)).toContainEqual(
      expect.objectContaining({ event: 'restore.counts_mismatch' }),
    )
  })
})
