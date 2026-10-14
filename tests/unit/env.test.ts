import { describe, expect, it } from 'vitest'

import { assertServerEnv, parseServerEnv } from '../../src/lib/env'

const SECRET = 'a'.repeat(64)
const DB_PASSWORD = 'db-pass-9f3c'
const valid = {
  DATABASE_URL: `postgres://trds:${DB_PASSWORD}@postgres:5432/trds`,
  PAYLOAD_SECRET: SECRET,
}

describe('parseServerEnv', () => {
  it('returns typed values for a valid environment', () => {
    const result = parseServerEnv(valid)
    expect(result).toEqual({ ok: true, env: valid })
  })

  it('reports a missing secret by name', () => {
    const result = parseServerEnv({ ...valid, PAYLOAD_SECRET: undefined })
    expect(result).toEqual({ ok: false, problems: ['PAYLOAD_SECRET: required'] })
  })

  it('treats an empty value as missing', () => {
    const result = parseServerEnv({ ...valid, PAYLOAD_SECRET: '' })
    expect(result).toEqual({ ok: false, problems: ['PAYLOAD_SECRET: required'] })
  })

  it('rejects a short secret', () => {
    const result = parseServerEnv({ ...valid, PAYLOAD_SECRET: 'short' })
    expect(result).toEqual({
      ok: false,
      problems: ['PAYLOAD_SECRET: must be at least 32 characters'],
    })
  })

  it('rejects a non-PostgreSQL database URL', () => {
    const result = parseServerEnv({ ...valid, DATABASE_URL: `mysql://u:${DB_PASSWORD}@h/db` })
    expect(result).toEqual({ ok: false, problems: ['DATABASE_URL: must be a postgres:// URL'] })
  })

  it('never includes provided values in problems', () => {
    const result = parseServerEnv({
      DATABASE_URL: `mysql://u:${DB_PASSWORD}@h/db`,
      PAYLOAD_SECRET: 'short-secret-value',
    })
    const text = JSON.stringify(result)
    expect(text).not.toContain(DB_PASSWORD)
    expect(text).not.toContain('short-secret-value')
  })
})

describe('assertServerEnv', () => {
  it('exits with code 1 and lists only variable names when invalid', () => {
    const output: string[] = []
    let exitCode: number | undefined
    assertServerEnv(
      { DATABASE_URL: `postgres://trds:${DB_PASSWORD}@h/db` },
      { write: (s) => output.push(s), exit: (code) => void (exitCode = code) },
    )
    expect(exitCode).toBe(1)
    expect(output.join('')).toContain('PAYLOAD_SECRET: required')
    expect(output.join('')).not.toContain(DB_PASSWORD)
  })

  it('returns the environment and does not exit when valid', () => {
    let exited = false
    const env = assertServerEnv(valid, { write: () => {}, exit: () => void (exited = true) })
    expect(exited).toBe(false)
    expect(env?.PAYLOAD_SECRET).toBe(SECRET)
  })
})
