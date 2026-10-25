import { describe, expect, it } from 'vitest'

import {
  ARCHIVE_LIMIT,
  CLIENT_STATUS_EMAIL_ENABLED,
  LEAD_TRANSITIONS,
  canTransition,
  createLeadBoardService,
} from '../../src/modules/lead-requests/board'
import {
  LEAD_CREATED_KIND,
  createLeadRequestService,
  leadCreatedDedupeKey,
  memoryLeadStore,
} from '../../src/modules/lead-requests/service'

// T-065: канбан — единственный use-case смены статуса (условный переход + история + аудит),
// T-034: новая заявка пишет событие outbox `lead.created` в той же операции.
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

const ADMIN = { staffId: '7', correlationId: 'req-1' }
const STAFF = new Set(['7', '8'])

const setup = async (n = 1) => {
  let now = new Date('2026-10-25T10:00:00Z').getTime()
  const store = memoryLeadStore()
  const leads = createLeadRequestService({ store, now: () => new Date(now) })
  const board = createLeadBoardService({ store, now: () => new Date(now) })
  for (let i = 0; i < n; i++) {
    await leads.submit({
      form: { ...form, email: `guest${i}@example.com` },
      idempotencyKey: `key-${i}-0123456789abcdef`,
      source: 'corporate',
    })
    now += 1000
  }
  const ids = store.dump().leads.map((l) => l.id)
  return { store, leads, board, ids, tick: (ms: number) => (now += ms) }
}

describe('lead submission → outbox', () => {
  it('writes exactly one lead.created event with only the lead id in its payload', async () => {
    const { store, leads, ids } = await setup()
    // Повтор того же нажатия — второго события нет.
    await leads.submit({
      form: { ...form, email: 'guest0@example.com' },
      idempotencyKey: 'key-0-0123456789abcdef',
      source: 'corporate',
    })
    const { outbox } = store.dump()
    expect(outbox).toHaveLength(1)
    expect(outbox[0]).toMatchObject({
      kind: LEAD_CREATED_KIND,
      dedupeKey: leadCreatedDedupeKey(ids[0]!),
      aggregateId: ids[0],
      payload: { leadId: ids[0] },
      status: 'pending',
      attempts: 0,
    })
    expect(JSON.stringify(outbox)).not.toMatch(/guest0@|Сенютина|Новогодний/)
  })

  it('new leads land in «Новые» without an assignee', async () => {
    const { board } = await setup(2)
    const cards = await board.board()
    expect(cards.map((c) => c.status)).toEqual(['new', 'new'])
    expect(cards.every((c) => c.assignee === null)).toBe(true)
  })
})

describe('lead board', () => {
  it('cards carry no contact data; the detail does', async () => {
    const { board, ids } = await setup()
    const [card] = await board.board()
    expect(Object.keys(card!).sort()).toEqual(
      [
        'assignee',
        'createdAt',
        'duplicate',
        'eventDate',
        'format',
        'guests',
        'id',
        'name',
        'status',
      ].sort(),
    )
    expect(JSON.stringify(card)).not.toContain('@')
    const detail = await board.detail(ids[0]!)
    expect(detail).toMatchObject({ email: 'guest0@example.com', comment: 'Новогодний вечер' })
    expect(detail?.history).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: 'new' }),
    ])
  })

  it('moves a card, writing a history row with the actor and an audit row in the same step', async () => {
    const { board, store, ids } = await setup()
    expect(await board.move({ id: ids[0], from: 'new', to: 'in_progress' }, ADMIN)).toEqual({
      ok: true,
      status: 'in_progress',
    })
    const { leads, history, audit } = store.dump()
    expect(leads[0]!.status).toBe('in_progress')
    expect(history.at(-1)).toMatchObject({ fromStatus: 'new', toStatus: 'in_progress', actor: '7' })
    expect(audit).toEqual([
      expect.objectContaining({
        actor: 'admin-users:7',
        action: 'cms.lead.move',
        entity: 'leads_requests',
        entityId: ids[0],
        reason: 'new → in_progress',
        result: 'ok',
        correlationId: 'req-1',
      }),
    ])
    // В журнале — только id, без контактов заявителя.
    expect(JSON.stringify(audit)).not.toContain('@')
  })

  it('rejects a stale move (another tab already moved the card) without writing anything', async () => {
    const { board, store, ids } = await setup()
    await board.move({ id: ids[0], from: 'new', to: 'in_progress' }, ADMIN)
    const before = store.dump()
    expect(await board.move({ id: ids[0], from: 'new', to: 'done' }, ADMIN)).toEqual({
      ok: false,
      error: 'conflict',
      status: 'in_progress',
    })
    expect(store.dump().history).toHaveLength(before.history.length)
    expect(store.dump().audit).toHaveLength(before.audit.length)
  })

  it('two parallel moves from the same status: exactly one wins', async () => {
    const { board, store, ids } = await setup()
    const results = await Promise.all([
      board.move({ id: ids[0], from: 'new', to: 'in_progress' }, ADMIN),
      board.move({ id: ids[0], from: 'new', to: 'done' }, { staffId: '8' }),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(store.dump().history.filter((h) => h.fromStatus === 'new')).toHaveLength(1)
  })

  it('enforces the transition table: archive only goes back to «Новые»', async () => {
    const { board, ids } = await setup()
    expect(canTransition('archived', 'done')).toBe(false)
    expect(LEAD_TRANSITIONS.archived).toEqual(['new'])
    await board.move({ id: ids[0], from: 'new', to: 'archived' }, ADMIN)
    expect(await board.move({ id: ids[0], from: 'archived', to: 'done' }, ADMIN)).toEqual({
      ok: false,
      error: 'invalid_transition',
    })
    expect(await board.move({ id: ids[0], from: 'archived', to: 'new' }, ADMIN)).toMatchObject({
      ok: true,
    })
  })

  it('validates input and reports a missing lead', async () => {
    const { board, ids } = await setup()
    expect(await board.move({ id: 'nope', from: 'new', to: 'done' }, ADMIN)).toEqual({
      ok: false,
      error: 'invalid',
    })
    expect(await board.move({ id: ids[0], from: 'new', to: 'paid' }, ADMIN)).toEqual({
      ok: false,
      error: 'invalid',
    })
    expect(await board.move({ id: ids[0], from: 'new', to: 'new' }, ADMIN)).toEqual({
      ok: false,
      error: 'invalid_transition',
    })
    expect(
      await board.move(
        { id: '00000000-0000-4000-8000-000000000000', from: 'new', to: 'done' },
        ADMIN,
      ),
    ).toEqual({ ok: false, error: 'not_found' })
    expect(await board.detail('not-a-uuid')).toBeNull()
  })

  it('client email on status change stays off until the theatre confirms', async () => {
    const { board, store, ids } = await setup()
    expect(CLIENT_STATUS_EMAIL_ENABLED).toBe(false)
    expect(
      await board.move({ id: ids[0], from: 'new', to: 'done', notifyClient: true }, ADMIN),
    ).toEqual({ ok: false, error: 'client_email_disabled' })
    expect(store.dump().leads[0]!.status).toBe('new')
  })

  it('assigns only existing staff, conditionally on the assignee the admin saw, with audit', async () => {
    const { board, store, ids } = await setup()
    expect(
      await board.assign({ id: ids[0], expected: null, assignee: '99' }, ADMIN, STAFF),
    ).toEqual({
      ok: false,
      error: 'unknown_staff',
    })
    expect(await board.assign({ id: ids[0], expected: null, assignee: 8 }, ADMIN, STAFF)).toEqual({
      ok: true,
      assignee: '8',
    })
    // Устаревшее «было» — конфликт, а не тихая перезапись.
    expect(await board.assign({ id: ids[0], expected: null, assignee: '7' }, ADMIN, STAFF)).toEqual(
      {
        ok: false,
        error: 'conflict',
        assignee: '8',
      },
    )
    expect(await board.assign({ id: ids[0], expected: '8', assignee: null }, ADMIN, STAFF)).toEqual(
      {
        ok: true,
        assignee: null,
      },
    )
    expect(store.dump().audit.map((a) => [a.action, a.reason])).toEqual([
      ['cms.lead.assign', '— → 8'],
      ['cms.lead.assign', '8 → —'],
    ])
  })

  it('keeps every active card but only the latest archived ones on the board', async () => {
    const { board, ids, store } = await setup(3)
    for (const id of ids) await board.move({ id, from: 'new', to: 'archived' }, ADMIN)
    expect(await store.listCards(2)).toHaveLength(2)
    expect((await board.board()).length).toBe(Math.min(3, ARCHIVE_LIMIT))
  })
})
