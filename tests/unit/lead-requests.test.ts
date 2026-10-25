import { describe, expect, it } from 'vitest'

import {
  createLeadRequestService,
  DUPLICATE_WINDOW_MS,
  LEAD_STATUS_LABELS,
  memoryLeadStore,
} from '../../src/modules/lead-requests/service'

const form = {
  name: 'Тати Сенютина',
  email: 'tati@stolnik.ru',
  phone: '',
  date: '2026-12-25',
  guests: '40',
  format: 'corporate',
  budget: '',
  comment: 'Новогодний вечер',
  consent: true,
}
const KEY = '7f0c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f'

const setup = () => {
  let now = new Date('2026-10-25T10:00:00Z').getTime()
  const store = memoryLeadStore()
  const leads = createLeadRequestService({ store, now: () => new Date(now) })
  return { leads, store, tick: (ms: number) => (now += ms) }
}

describe('lead requests', () => {
  it('stores a new lead with status «Новая», its first history row and a consent entry', async () => {
    const { leads, store } = setup()
    expect(await leads.submit({ form, idempotencyKey: KEY, source: 'corporate' })).toEqual({
      ok: true,
      status: 'new',
      replay: false,
    })
    const { leads: rows, history, consents } = store.dump()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: 'new',
      name: 'Тати Сенютина',
      email: 'tati@stolnik.ru',
      phone: null,
      eventDate: '2026-12-25',
      guests: 40,
      assignee: null,
      duplicateOf: null,
    })
    expect(LEAD_STATUS_LABELS[rows[0]!.status]).toBe('Новая')
    expect(history).toEqual([
      expect.objectContaining({ leadId: rows[0]!.id, fromStatus: null, toStatus: 'new' }),
    ])
    // Журнал согласия без персональных данных — ссылка на заявку, документ и версия.
    expect(consents).toEqual([
      expect.objectContaining({
        document: 'personal-data',
        context: 'lead',
        subjectRef: `lead:${rows[0]!.id}`,
        version: expect.any(String),
      }),
    ])
    expect(JSON.stringify(consents)).not.toContain('tati@')
  })

  it('does not create a second lead when the same submission is retried', async () => {
    const { leads, store } = setup()
    await leads.submit({ form, idempotencyKey: KEY, source: 'corporate' })
    expect(await leads.submit({ form, idempotencyKey: KEY, source: 'corporate' })).toEqual({
      ok: true,
      status: 'new',
      replay: true,
    })
    expect(store.dump().leads).toHaveLength(1)
    expect(store.dump().consents).toHaveLength(1)
  })

  it('survives two parallel submissions of the same click', async () => {
    const { leads, store } = setup()
    const results = await Promise.all([
      leads.submit({ form, idempotencyKey: KEY, source: 'corporate' }),
      leads.submit({ form, idempotencyKey: KEY, source: 'corporate' }),
    ])
    expect(results.every((r) => r.ok)).toBe(true)
    expect(store.dump().leads).toHaveLength(1)
  })

  it('refuses to silently replace a lead when the key comes back with other content', async () => {
    const { leads, store } = setup()
    await leads.submit({ form, idempotencyKey: KEY, source: 'corporate' })
    expect(
      await leads.submit({
        form: { ...form, guests: '80' },
        idempotencyKey: KEY,
        source: 'corporate',
      }),
    ).toEqual({ ok: false, error: 'conflict' })
    expect(store.dump().leads[0]!.guests).toBe(40)
  })

  it('keeps a new submission from the same contact, but marks it as a possible duplicate', async () => {
    const { leads, store, tick } = setup()
    await leads.submit({ form, idempotencyKey: KEY, source: 'corporate' })
    tick(60_000)
    await leads.submit({
      form: { ...form, email: 'TATI@stolnik.ru', comment: 'Ещё раз' },
      idempotencyKey: 'b'.repeat(32),
      source: 'corporate',
    })
    const [first, second] = store.dump().leads
    expect(second!.duplicateOf).toBe(first!.id)

    tick(DUPLICATE_WINDOW_MS + 1)
    await leads.submit({ form, idempotencyKey: 'c'.repeat(32), source: 'corporate' })
    expect(store.dump().leads[2]!.duplicateOf).toBeNull()
  })

  it('matches duplicates by phone too', async () => {
    const { leads, store } = setup()
    const byPhone = { ...form, email: '', phone: '+7 912 345-67-89' }
    await leads.submit({ form: byPhone, idempotencyKey: KEY, source: 'corporate' })
    await leads.submit({
      form: { ...byPhone, phone: '89123456789' },
      idempotencyKey: 'd'.repeat(32),
      source: 'corporate',
    })
    const [first, second] = store.dump().leads
    expect(second!.duplicateOf).toBe(first!.id)
  })

  it('validates with the same rules as the form and writes nothing on error', async () => {
    const { leads, store } = setup()
    const r = await leads.submit({
      form: { ...form, consent: false, guests: '0' },
      idempotencyKey: KEY,
      source: 'corporate',
    })
    expect(r).toEqual({
      ok: false,
      error: 'invalid',
      fields: {
        guests: 'Число гостей — от 1 до 1000',
        consent: 'Нужно согласие на обработку персональных данных',
      },
    })
    expect(
      await leads.submit({ form: null, idempotencyKey: KEY, source: 'corporate' }),
    ).toMatchObject({ ok: false, error: 'invalid' })
    expect(store.dump().leads).toEqual([])
  })

  it('requires a sane idempotency key', async () => {
    const { leads } = setup()
    for (const key of [undefined, '', 'short', 'x'.repeat(65), 'has space in it ........'])
      expect(await leads.submit({ form, idempotencyKey: key, source: 'corporate' })).toEqual({
        ok: false,
        error: 'invalid_key',
      })
  })
})

describe('lead requests API shape', () => {
  it('lets a client omit optional fields', async () => {
    const { leads } = setup()
    expect(
      await leads.submit({
        form: { name: 'Тати', phone: '+79123456789', format: 'birthday', consent: true },
        idempotencyKey: KEY,
        source: 'corporate',
      }),
    ).toMatchObject({ ok: true })
  })
})
