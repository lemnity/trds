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
}
type Compose = {
  services: Record<string, Service>
  networks: Record<string, { internal?: boolean } | null>
}

const root = path.resolve(import.meta.dirname, '../..')
const compose = parse(readFileSync(path.join(root, 'docker-compose.yml'), 'utf8')) as Compose
const service = (name: string) => {
  const s = compose.services[name]
  if (!s) throw new Error(`service ${name} is missing`)
  return s
}

describe('docker-compose.yml', () => {
  it('defines app, worker, postgres and caddy', () => {
    expect(Object.keys(compose.services).sort()).toEqual(['app', 'caddy', 'postgres', 'worker'])
  })

  it('keeps PostgreSQL unreachable from outside', () => {
    const postgres = service('postgres')
    expect(postgres.ports).toBeUndefined()
    expect(postgres.networks).toEqual(['backend'])
    expect(compose.networks.backend?.internal).toBe(true)
  })

  it('publishes ports only through caddy', () => {
    for (const name of ['app', 'worker', 'postgres']) {
      expect(service(name).ports).toBeUndefined()
    }
    expect(service('caddy').ports?.length).toBeGreaterThan(0)
  })

  it('pins third-party images by digest', () => {
    for (const name of ['postgres', 'caddy']) {
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
})
