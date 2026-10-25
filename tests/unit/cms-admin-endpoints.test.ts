import type { Endpoint, PayloadRequest } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLeadBoardService } from '../../src/modules/lead-requests/board'
import { createLeadRequestService, memoryLeadStore } from '../../src/modules/lead-requests/service'
import type { StaffRole, StaffUser } from '../../src/payload/access/roles'
import type { CmsAuditEntry } from '../../src/payload/audit'
import { MFA_COOKIE, deriveMfaKeys, signMfaCookie } from '../../src/payload/auth/mfa'
import { certificateEndpoints, endOfMoscowDay } from '../../src/payload/endpoints/certificates'
import { leadEndpoints } from '../../src/payload/endpoints/leads'

// T-065/T-066 + rules.md §4: права своих разделов админки — на сервере. Кассир и редактор не
// двигают карточки и не выпускают сертификаты; администратор без второго фактора — тоже;
// изменяющие запросы — только со своего origin; каждое действие и отказ — в журнале.
const SECRET = 'admin-endpoints-test-secret-0123456789abcd'
const NOW = new Date('2026-10-26T09:00:00Z')

beforeAll(() => vi.stubEnv('PAYLOAD_SECRET', SECRET))
afterAll(() => vi.unstubAllEnvs())

let nextId = 100
const staff = (role: StaffRole, extra: Partial<StaffUser> = {}): StaffUser => {
  const id = nextId++
  return {
    id,
    email: `${role}${id}@example.com`,
    role,
    collection: 'admin-users',
    _sid: `sid-${id}`,
    ...extra,
  }
}

const reqOf = (
  user: StaffUser | null,
  {
    mfa = true,
    origin = 'https://cms.test',
    params = {} as Record<string, string>,
    body = {} as unknown,
    search = '',
  } = {},
) => {
  const headers = new Headers({ host: 'cms.test' })
  if (origin) headers.set('origin', origin)
  if (user && mfa)
    headers.set(
      'cookie',
      `${MFA_COOKIE}=${signMfaCookie(
        { userId: String(user.id), sid: user._sid!, expiresAt: new Date(Date.now() + 3600_000) },
        deriveMfaKeys(SECRET).cookie,
      )}`,
    )
  return {
    user,
    headers,
    context: {},
    routeParams: params,
    searchParams: new URLSearchParams(search),
    json: async () => body,
  } as unknown as PayloadRequest
}

const call = async (endpoints: Endpoint[], method: string, path: string, req: PayloadRequest) => {
  const ep = endpoints.find((e) => e.method === method && e.path === path)
  if (!ep) throw new Error(`no endpoint ${method} ${path}`)
  const res = await ep.handler(req)
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, res }
}

describe('kanban endpoints', () => {
  let audit: CmsAuditEntry[]
  let store: ReturnType<typeof memoryLeadStore>
  let endpoints: Endpoint[]
  let leadId: string
  const admin = staff('admin')

  beforeEach(async () => {
    audit = []
    store = memoryLeadStore()
    await createLeadRequestService({ store, now: () => NOW }).submit({
      form: {
        name: 'Гость',
        email: 'guest@example.com',
        phone: '',
        date: '',
        guests: '12',
        format: 'corporate',
        budget: '',
        comment: '',
        consent: true,
      },
      idempotencyKey: 'endpoint-key-0123456789',
      source: 'corporate',
    })
    leadId = store.dump().leads[0]!.id
    endpoints = leadEndpoints({
      board: () => createLeadBoardService({ store, now: () => NOW }),
      staff: async () => [{ id: String(admin.id), label: 'Администратор' }],
      audit: async (_req, entry) => void audit.push(entry),
    })
  })

  it.each(['cashier', 'editor'] as const)(
    '%s can neither read the board nor move cards',
    async (role) => {
      const user = staff(role)
      expect((await call(endpoints, 'get', '/cms/leads', reqOf(user))).status).toBe(403)
      expect(
        (await call(endpoints, 'get', '/cms/leads/:id', reqOf(user, { params: { id: leadId } })))
          .status,
      ).toBe(403)
      const move = await call(
        endpoints,
        'post',
        '/cms/leads/:id/move',
        reqOf(user, { params: { id: leadId }, body: { from: 'new', to: 'done' } }),
      )
      expect(move).toMatchObject({ status: 403, body: { error: 'forbidden' } })
      const assign = await call(
        endpoints,
        'post',
        '/cms/leads/:id/assign',
        reqOf(user, {
          params: { id: leadId },
          body: { expected: null, assignee: String(admin.id) },
        }),
      )
      expect(assign.status).toBe(403)
      expect(store.dump().leads[0]).toMatchObject({ status: 'new', assignee: null })
      expect(audit).toEqual([
        expect.objectContaining({ action: 'cms.lead.move', entityId: leadId, result: 'denied' }),
        expect.objectContaining({ action: 'cms.lead.assign', entityId: leadId, result: 'denied' }),
      ])
    },
  )

  it('an admin without the second factor has no rights; anonymous gets 401', async () => {
    expect(await call(endpoints, 'get', '/cms/leads', reqOf(admin, { mfa: false }))).toMatchObject({
      status: 403,
      body: { error: 'mfa_required' },
    })
    expect((await call(endpoints, 'get', '/cms/leads', reqOf(null))).status).toBe(401)
  })

  it('rejects a cross-origin move even from an admin', async () => {
    const r = await call(
      endpoints,
      'post',
      '/cms/leads/:id/move',
      reqOf(admin, {
        origin: 'https://evil.test',
        params: { id: leadId },
        body: { from: 'new', to: 'done' },
      }),
    )
    expect(r.status).toBe(403)
    expect(store.dump().leads[0]!.status).toBe('new')
  })

  it('admin: board without contacts, detail with them, move with history and audit', async () => {
    const board = await call(endpoints, 'get', '/cms/leads', reqOf(admin))
    expect(board.status).toBe(200)
    expect(board.res.headers.get('cache-control')).toBe('no-store')
    expect(JSON.stringify(board.body.cards)).not.toContain('guest@example.com')
    expect(board.body).toMatchObject({
      clientEmailEnabled: false,
      transitions: { archived: ['new'] },
    })

    const detail = await call(
      endpoints,
      'get',
      '/cms/leads/:id',
      reqOf(admin, { params: { id: leadId } }),
    )
    expect(detail.body.lead).toMatchObject({ email: 'guest@example.com' })

    const moved = await call(
      endpoints,
      'post',
      '/cms/leads/:id/move',
      reqOf(admin, { params: { id: leadId }, body: { from: 'new', to: 'in_progress' } }),
    )
    expect(moved).toMatchObject({ status: 200, body: { ok: true, status: 'in_progress' } })
    const stale = await call(
      endpoints,
      'post',
      '/cms/leads/:id/move',
      reqOf(admin, { params: { id: leadId }, body: { from: 'new', to: 'done' } }),
    )
    expect(stale).toMatchObject({ status: 409, body: { error: 'conflict', status: 'in_progress' } })
    expect(store.dump().audit).toEqual([
      expect.objectContaining({
        action: 'cms.lead.move',
        actor: `admin-users:${admin.id}`,
        result: 'ok',
      }),
    ])
    expect(store.dump().history.at(-1)).toMatchObject({
      actor: String(admin.id),
      toStatus: 'in_progress',
    })
  })

  it('admin assigns only a known staff member', async () => {
    const bad = await call(
      endpoints,
      'post',
      '/cms/leads/:id/assign',
      reqOf(admin, { params: { id: leadId }, body: { expected: null, assignee: '9999' } }),
    )
    expect(bad).toMatchObject({ status: 422, body: { error: 'unknown_staff' } })
    const ok = await call(
      endpoints,
      'post',
      '/cms/leads/:id/assign',
      reqOf(admin, {
        params: { id: leadId },
        body: { expected: null, assignee: String(admin.id) },
      }),
    )
    expect(ok).toMatchObject({ status: 200, body: { ok: true, assignee: String(admin.id) } })
  })
})

describe('certificate endpoints', () => {
  let audit: CmsAuditEntry[]
  const calls = { issue: [] as unknown[], annul: [] as number[] }
  const annullable = new Set([5])
  const admin = staff('admin')

  const endpoints = () =>
    certificateEndpoints({
      now: () => NOW,
      audit: async (_req, entry) => void audit.push(entry),
      list: async (_req, opts) =>
        ({ items: [], total: 0, page: opts.page, pageSize: 50, opts }) as never,
      wallet: async () => ({
        issueCertificates: async (input) => {
          calls.issue.push(input)
          return Array.from({ length: input.count }, (_, i) => ({
            serial: `С-0000${41 + i}`,
            code: `FULL-CODE-${i}-SECRET`,
          }))
        },
        annulCertificate: async (serial) => {
          calls.annul.push(serial)
          return annullable.delete(serial)
        },
      }),
    })

  beforeEach(() => {
    audit = []
    calls.issue = []
    calls.annul = []
  })

  it.each(['cashier', 'editor'] as const)('%s cannot list, issue or annul', async (role) => {
    const user = staff(role)
    const eps = endpoints()
    expect((await call(eps, 'get', '/cms/certificates', reqOf(user))).status).toBe(403)
    expect(
      (
        await call(
          eps,
          'post',
          '/cms/certificates/issue',
          reqOf(user, { body: { amountRub: 3000, count: 2 } }),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await call(
          eps,
          'post',
          '/cms/certificates/:id/annul',
          reqOf(user, { params: { id: '5' }, body: { reason: 'потерян' } }),
        )
      ).status,
    ).toBe(403)
    expect(calls.issue).toEqual([])
    expect(calls.annul).toEqual([])
    expect(audit.map((a) => [a.action, a.result])).toEqual([
      ['cms.certificate.issue', 'denied'],
      ['cms.certificate.annul', 'denied'],
    ])
  })

  it('an admin without MFA cannot issue', async () => {
    const r = await call(
      endpoints(),
      'post',
      '/cms/certificates/issue',
      reqOf(admin, { mfa: false, body: { amountRub: 3000, count: 2 } }),
    )
    expect(r).toMatchObject({ status: 403, body: { error: 'mfa_required' } })
    expect(calls.issue).toEqual([])
  })

  it('admin issues a batch: full codes only in the uncached response, audit without codes', async () => {
    const r = await call(
      endpoints(),
      'post',
      '/cms/certificates/issue',
      reqOf(admin, {
        body: { amountRub: '3000', count: '2', validUntil: '2027-12-31', comment: 'Для партнёра' },
      }),
    )
    expect(r.status).toBe(200)
    expect(r.res.headers.get('cache-control')).toBe('no-store')
    expect(r.body).toMatchObject({
      amountRub: 3000,
      validUntil: '2027-12-31',
      certificates: [
        { serial: 'С-000041', code: 'FULL-CODE-0-SECRET' },
        { serial: 'С-000042', code: 'FULL-CODE-1-SECRET' },
      ],
    })
    expect(calls.issue).toEqual([
      {
        amountKopecks: 300_000,
        count: 2,
        validUntil: new Date('2027-12-31T23:59:59.999+03:00'),
        comment: 'Для партнёра',
        issuedBy: `admin-users:${admin.id}`,
      },
    ])
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'cms.certificate.issue',
        entityId: 'С-000041..С-000042',
        result: 'ok',
      }),
    ])
    expect(JSON.stringify(audit)).not.toContain('SECRET')
  })

  it('validates the batch form', async () => {
    const r = await call(
      endpoints(),
      'post',
      '/cms/certificates/issue',
      reqOf(admin, { body: { amountRub: '0', count: 501, validUntil: '2020-01-01' } }),
    )
    expect(r.status).toBe(400)
    expect(Object.keys(r.body.fields as object).sort()).toEqual([
      'amountRub',
      'count',
      'validUntil',
    ])
    expect(calls.issue).toEqual([])
    expect(endOfMoscowDay('2027-02-31')).toBeNull()
  })

  it('annul requires a reason; a non-issued certificate is refused and logged as failed', async () => {
    const eps = endpoints()
    const noReason = await call(
      eps,
      'post',
      '/cms/certificates/:id/annul',
      reqOf(admin, { params: { id: '5' }, body: { reason: ' ' } }),
    )
    expect(noReason).toMatchObject({ status: 400, body: { error: 'reason_required' } })
    expect(calls.annul).toEqual([])

    const ok = await call(
      eps,
      'post',
      '/cms/certificates/:id/annul',
      reqOf(admin, { params: { id: '5' }, body: { reason: 'Утерян при доставке' } }),
    )
    expect(ok).toMatchObject({ status: 200, body: { ok: true, serial: 5 } })
    const again = await call(
      eps,
      'post',
      '/cms/certificates/:id/annul',
      reqOf(admin, { params: { id: '5' }, body: { reason: 'Повтор' } }),
    )
    expect(again).toMatchObject({ status: 409, body: { error: 'not_annullable' } })
    expect(audit.map((a) => [a.action, a.entityId, a.result, a.reason])).toEqual([
      ['cms.certificate.annul', '5', 'ok', 'Утерян при доставке'],
      ['cms.certificate.annul', '5', 'failed', 'Повтор'],
    ])
  })

  it('list passes only known status filters', async () => {
    const eps = endpoints()
    const r = await call(
      eps,
      'get',
      '/cms/certificates',
      reqOf(admin, { search: 'status=expired&page=2' }),
    )
    expect(r.body).toMatchObject({ page: 2, opts: { status: 'expired', page: 2 } })
    const bad = await call(
      eps,
      'get',
      '/cms/certificates',
      reqOf(admin, { search: 'status=drop&page=-1' }),
    )
    expect(bad.body).toMatchObject({ opts: { status: null, page: 1 } })
  })
})
