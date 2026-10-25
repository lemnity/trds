import { describe, expect, it } from 'vitest'

import { ALERTS, createLogger, errorInfo, redact, redactString } from '../../src/lib/log'

// T-015, rules.md §4: в логах нет токенов, кодов, почты, телефонов и секретов.
const capture = (level: 'debug' | 'info' = 'debug') => {
  const lines: string[] = []
  const log = createLogger({
    level,
    base: { service: 'test' },
    write: (line) => lines.push(line),
    now: () => new Date('2026-10-25T10:00:00Z'),
  })
  return { log, lines, records: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) }
}

describe('redactString', () => {
  it('masks emails and phone numbers in free text', () => {
    const out = redactString('письмо для Ivan.Petrov+t@mail.example.ru, тел. +7 (912) 345-67-89')
    expect(out).not.toContain('Ivan.Petrov')
    expect(out).not.toContain('345-67-89')
    expect(out).toContain('[email]')
    expect(out).toContain('[phone]')
  })

  it('keeps ISO timestamps intact', () => {
    expect(redactString('oldest 2026-10-25 12:01:00+00')).toBe('oldest 2026-10-25 12:01:00+00')
    expect(redactString('at 2026-10-25T12:01:00.000Z')).toBe('at 2026-10-25T12:01:00.000Z')
  })

  it('masks one-time codes next to the word code', () => {
    expect(redactString('ваш код: 482913')).not.toContain('482913')
    expect(redactString('OTP 1234 sent')).not.toContain('1234')
  })

  it('masks bearer tokens, URL passwords and long tokens', () => {
    const out = redactString(
      'Authorization: Bearer abc.def.ghi postgres://trds:s3cr3t@postgres:5432/trds key=0123456789abcdef0123456789abcdef',
    )
    expect(out).not.toContain('abc.def.ghi')
    expect(out).not.toContain('s3cr3t')
    expect(out).not.toContain('0123456789abcdef0123456789abcdef')
    expect(out).toContain('postgres://trds:[redacted]@postgres:5432/trds')
  })

  it('keeps UUIDs, dates and ordinary numbers', () => {
    const text = 'order 3f1c2a4e-9b7d-4c1e-8f00-0123456789ab at 2026-10-25, amount 150000'
    expect(redactString(text)).toBe(text)
  })
})

describe('redact', () => {
  it('drops secret fields by name, at any depth', () => {
    const out = redact({
      password: 'x',
      sessionToken: 't',
      session: 's',
      PAYLOAD_SECRET: 'p',
      nested: { codeHash: 'h', api_key: 'k', authCode: '1234', cookie: 'c' },
    })
    expect(JSON.stringify(out)).not.toMatch(/"(x|t|s|p|h|k|1234|c)"/)
  })

  it('masks personal fields even when the value does not look like PII', () => {
    expect(redact({ email: 'not-an-email', phone: '12', customerName: 'Анна' })).toEqual({
      email: '[pii]',
      phone: '[pii]',
      customerName: '[pii]',
    })
  })

  it('treats a digit-only code field as a login code but keeps error codes', () => {
    expect(redact({ code: '123456' })).toEqual({ code: '[redacted]' })
    expect(redact({ code: 'invalid_input' })).toEqual({ code: 'invalid_input' })
  })

  it('keeps counters and safe identifiers', () => {
    expect(
      redact({
        job: 'accounts.cleanup',
        codesDeleted: 3,
        sessionsDeleted: 1,
        correlationId: 'req-12345678',
      }),
    ).toEqual({
      job: 'accounts.cleanup',
      codesDeleted: 3,
      sessionsDeleted: 1,
      correlationId: 'req-12345678',
    })
  })

  it('logs errors as type and machine code only', () => {
    const error = Object.assign(new Error('duplicate key for anna@example.ru'), {
      code: 'ECONNREFUSED',
    })
    expect(redact({ error })).toEqual({ error: { name: 'Error', code: 'ECONNREFUSED' } })
    expect(errorInfo('boom')).toEqual({ name: 'UnknownError' })
  })
})

describe('createLogger', () => {
  it('writes one JSON line with ts, level, event and base fields', () => {
    const { log, records } = capture()
    log.info('order.created', { orderId: 'o-1' })
    expect(records()).toEqual([
      {
        ts: '2026-10-25T10:00:00.000Z',
        level: 'info',
        event: 'order.created',
        service: 'test',
        orderId: 'o-1',
      },
    ])
  })

  it('filters below the configured level', () => {
    const { log, lines } = capture('info')
    log.debug('noise')
    log.warn('kept')
    expect(lines).toHaveLength(1)
  })

  it('carries child fields such as the correlation id', () => {
    const { log, records } = capture()
    log.child({ correlationId: 'abc-12345678' }).error('api.failed', { email: 'a@b.ru' })
    expect(records()[0]).toMatchObject({ correlationId: 'abc-12345678', email: '[pii]' })
  })

  it('emits alerts with a stable code that fields cannot override', () => {
    const { log, records } = capture()
    log.alert(ALERTS.outboxStuck, { stuck: 4, alert: 'spoofed' })
    expect(records()[0]).toMatchObject({
      level: 'error',
      event: 'alert',
      alert: 'ALERT_OUTBOX_STUCK',
      stuck: 4,
    })
  })

  it('never throws when the sink fails', () => {
    const log = createLogger({
      write: () => {
        throw new Error('EPIPE')
      },
    })
    expect(() => log.error('x')).not.toThrow()
  })
})
