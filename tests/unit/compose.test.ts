import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

// T-012: свойства production-окружения, которые нельзя потерять при правках compose.
type Service = {
  image?: string
  build?: unknown
  command?: string | string[]
  ports?: unknown[]
  networks?: string[]
  healthcheck?: unknown
  depends_on?: Record<string, { condition: string }>
  environment?: Record<string, string>
  entrypoint?: string[]
  volumes?: string[]
}
type Compose = {
  services: Record<string, Service>
  networks: Record<string, { internal?: boolean } | null>
}

const root = path.resolve(import.meta.dirname, '../..')
// merge: раскрывать `<<: *app-env`, как это делает docker compose.
const compose = parse(readFileSync(path.join(root, 'docker-compose.yml'), 'utf8'), {
  merge: true,
}) as Compose
const service = (name: string) => {
  const s = compose.services[name]
  if (!s) throw new Error(`service ${name} is missing`)
  return s
}

describe('docker-compose.yml', () => {
  it('defines app, worker, postgres, caddy and backup', () => {
    expect(Object.keys(compose.services).sort()).toEqual([
      'app',
      'backup',
      'caddy',
      'postgres',
      'worker',
    ])
  })

  it('keeps PostgreSQL unreachable from outside', () => {
    const postgres = service('postgres')
    expect(postgres.ports).toBeUndefined()
    expect(postgres.networks).toEqual(['backend'])
    expect(compose.networks.backend?.internal).toBe(true)
  })

  it('publishes ports only through caddy', () => {
    for (const name of ['app', 'worker', 'postgres', 'backup']) {
      expect(service(name).ports).toBeUndefined()
    }
    expect(service('caddy').ports?.length).toBeGreaterThan(0)
  })

  it('pins third-party images by digest', () => {
    for (const name of ['postgres', 'caddy', 'backup']) {
      expect(service(name).image).toMatch(/:[\w.-]+@sha256:[0-9a-f]{64}$/)
    }
  })

  it('runs app and worker from the same project image', () => {
    expect(service('app').image).toBe(service('worker').image)
    expect(service('app').build).toBeDefined()
    expect(service('worker').command).toEqual(['node', 'worker.mjs'])
  })

  it('starts app and worker only after a healthy database', () => {
    for (const name of ['app', 'worker']) {
      expect(service(name).depends_on?.postgres?.condition).toBe('service_healthy')
    }
    expect(service('postgres').healthcheck).toBeDefined()
    expect(service('app').healthcheck).toBeDefined()
  })

  it('takes secrets only from the environment, never inline', () => {
    for (const [name, s] of Object.entries(compose.services)) {
      for (const [key, value] of Object.entries(s.environment ?? {})) {
        if (/PASSWORD|SECRET|DATABASE_URL/.test(key)) {
          expect(value, `${name}.${key}`).toMatch(/\$\{[A-Z_]+:\?/)
        }
      }
    }
  })

  // T-014/T-015: бэкап и файлы состояния для /api/health.
  it('runs daily backups with the same PostgreSQL image, inside the backend network only', () => {
    const backup = service('backup')
    expect(backup.image).toBe(service('postgres').image)
    expect(backup.networks).toEqual(['backend'])
    expect(backup.entrypoint).toEqual(['bash', '/scripts/backup-scheduler.sh'])
    expect(backup.depends_on?.postgres?.condition).toBe('service_healthy')
    expect(backup.volumes).toEqual(
      expect.arrayContaining(['./scripts:/scripts:ro', 'backups:/backups', 'ops-state:/app/state']),
    )
  })

  it('shares worker heartbeat and backup status with the app read-only', () => {
    expect(service('worker').volumes).toContain('ops-state:/app/state')
    expect(service('app').volumes).toContain('ops-state:/app/state:ro')
    for (const name of ['app', 'worker']) {
      expect(service(name).environment?.WORKER_HEARTBEAT_FILE).toBe(
        '/app/state/worker-heartbeat.json',
      )
    }
    expect(service('app').environment?.BACKUP_STATUS_FILE).toBe(
      service('backup').environment?.BACKUP_STATUS_FILE,
    )
  })
})
