import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// T-005 / ADR-007: версии стека закреплены точно и согласованы между
// package.json, .node-version, Dockerfile и CI.
const root = path.resolve(import.meta.dirname, '../..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

type PackageJson = {
  packageManager: string
  engines: { node: string; pnpm: string }
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  pnpm: { overrides?: Record<string, string> }
}
const pkg = JSON.parse(read('package.json')) as PackageJson
const nodeVersion = read('.node-version').trim()

const EXACT_SEMVER = /^\d+\.\d+\.\d+$/

const parseVersion = (v: string) => v.split('.').map(Number) as [number, number, number]
const compareVersions = (a: string, b: string) => {
  const [pa, pb] = [parseVersion(a), parseVersion(b)]
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!
  return 0
}

// Читаем только нужные места lock-файла pnpm v9, без YAML-зависимости.
const lockfile = read('pnpm-lock.yaml')
const lockSpecifier = (name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const match = new RegExp(`\\n {6}'?${escaped}'?:\\n {8}specifier: (\\S+)`).exec(lockfile)
  return match?.[1]
}
const ciJobLines = () =>
  read('.github/workflows/ci.yml')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('#'))

describe('stack version pins', () => {
  it('pins every dependency to an exact version', () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    const loose = Object.entries(all).filter(([, v]) => !EXACT_SEMVER.test(v))
    expect(loose).toEqual([])
  })

  it('pins all @payloadcms packages to the same version as payload', () => {
    const payloadPkgs = Object.entries(pkg.dependencies).filter(([name]) =>
      name.startsWith('@payloadcms/'),
    )
    expect(payloadPkgs.length).toBeGreaterThan(0)
    for (const [, version] of payloadPkgs) {
      expect(version).toBe(pkg.dependencies.payload)
    }
  })

  it('keeps react and react-dom on the same version', () => {
    expect(pkg.dependencies['react-dom']).toBe(pkg.dependencies.react)
  })

  it('pins Node.js to an exact 24.x release', () => {
    expect(nodeVersion).toMatch(/^24\.\d+\.\d+$/)
  })

  it('keeps .node-version inside the engines.node range', () => {
    const range = /^>=(\d+\.\d+\.\d+) <(\d+)$/.exec(pkg.engines.node)
    expect(range).not.toBeNull()
    const [, min, maxMajor] = range!
    expect(compareVersions(nodeVersion, min!)).toBeGreaterThanOrEqual(0)
    expect(parseVersion(nodeVersion)[0]).toBeLessThan(Number(maxMajor))
  })

  it('has a lockfile that matches every package.json version', () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    const mismatched = Object.entries(all).filter(([name, v]) => lockSpecifier(name) !== v)
    expect(mismatched).toEqual([])
  })

  it('has a lockfile that records every pnpm override', () => {
    for (const [selector, version] of Object.entries(pkg.pnpm.overrides ?? {})) {
      expect(lockfile).toContain(`\n  ${selector}: ${version}\n`)
    }
  })

  it('uses the same pnpm version in packageManager and engines', () => {
    expect(pkg.packageManager).toBe(`pnpm@${pkg.engines.pnpm}`)
  })

  it('builds the Docker image from the pinned Node.js version', () => {
    const fromLines = read('Dockerfile')
      .split('\n')
      .filter((line) => line.startsWith('FROM node:'))
    expect(fromLines.length).toBeGreaterThan(0)
    for (const line of fromLines) {
      expect(line).toContain(`node:${nodeVersion}-`)
      expect(line).toMatch(/@sha256:[0-9a-f]{64}/)
    }
  })

  it('starts the app through the env-checking entrypoint', () => {
    // Последняя стадия — образ приложения (runner); раньше неё — одноразовые миграции (migrator).
    const cmd = read('Dockerfile')
      .split('\n')
      .filter((line) => line.startsWith('CMD '))
    expect(cmd.at(-1)).toBe('CMD ["node", "start.mjs"]')
    expect(cmd.slice(0, -1)).toEqual(['CMD ["pnpm", "-s", "payload", "migrate"]'])
  })

  it('runs CI on the pinned Node.js version with a frozen lockfile', () => {
    const lines = ciJobLines()
    expect(lines).toContain('node-version-file: .node-version')
    expect(lines).toContain('run: pnpm install --frozen-lockfile')
    expect(lines).toContain('run: pnpm build')
  })
})
