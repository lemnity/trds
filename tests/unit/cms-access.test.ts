import { Forbidden, type CollectionConfig, type Field, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { StaffRole, StaffUser } from '../../src/payload/access/roles'
import type { CmsAuditEntry } from '../../src/payload/audit'
import { MFA_COOKIE, deriveMfaKeys, signMfaCookie } from '../../src/payload/auth/mfa'
import { collections } from '../../src/payload/collections'
import {
  AdminUsers,
  auditUserChange,
  guardRoleChanges,
  guardUserDelete,
} from '../../src/payload/collections/AdminUsers'
import { SiteSettings } from '../../src/payload/globals/SiteSettings'

// T-023, plan-main.md §7.1/§7.4: права проверяются в access layer Payload (REST, GraphQL и
// Local API с overrideAccess: false), а не скрытием кнопок. Здесь — те самые функции доступа.
const SECRET = 'access-test-payload-secret-0123456789abcd'

beforeAll(() => {
  vi.stubEnv('PAYLOAD_SECRET', SECRET)
  vi.stubEnv('CMS_SYSTEM_ADMIN_EMAILS', 'root@example.com')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

let nextId = 10
const staff = (role: StaffRole, extra: Partial<StaffUser> = {}): StaffUser => ({
  id: nextId++,
  email: `${role}@example.com`,
  role,
  collection: 'admin-users',
  _sid: `sid-${nextId}`,
  ...extra,
})

/** Запрос сотрудника; `mfa` — пройден ли второй фактор в этой сессии. */
const reqOf = (user: StaffUser | null, { mfa = true, totalUsers = 5 } = {}) => {
  const cookie =
    user && mfa
      ? `${MFA_COOKIE}=${signMfaCookie(
          { userId: String(user.id), sid: user._sid!, expiresAt: new Date(Date.now() + 3600_000) },
          deriveMfaKeys(SECRET).cookie,
        )}`
      : ''
  return {
    user,
    headers: new Headers(cookie ? { cookie } : {}),
    context: {},
    payload: {
      count: async () => ({ totalDocs: totalUsers }),
      findByID: async ({ id }: { id: number }) => ({ id, role: 'admin' }),
    },
  } as unknown as PayloadRequest
}

type Op = 'create' | 'update' | 'delete'
const OPS: Op[] = ['create', 'update', 'delete']
const can = async (c: CollectionConfig, op: Op, req: PayloadRequest) => {
  const fn = c.access?.[op]
  // Без функции Payload пускает любого вошедшего — у коллекций CMS функции заданы всегда.
  if (!fn) throw new Error(`${c.slug}.${op}: access not set`)
  return fn({ req, id: 1, data: {} } as never)
}

const bySlug = (slug: string) => collections.find((c) => c.slug === slug)!

/** Поле по имени в любых вкладках, строках, группах. */
const findField = (fields: Field[], name: string): Field | undefined => {
  for (const f of fields) {
    if ('name' in f && f.name === name) return f
    const nested =
      'fields' in f && Array.isArray(f.fields)
        ? f.fields
        : 'tabs' in f
          ? f.tabs.flatMap((t) => t.fields)
          : []
    const found = findField(nested as Field[], name)
    if (found) return found
  }
  return undefined
}

const fieldCan = (
  c: { fields: Field[] },
  name: string,
  op: 'create' | 'update',
  req: PayloadRequest,
) => {
  const field = findField(c.fields, name)
  if (!field) throw new Error(`field ${name} not found`)
  const fn = 'access' in field ? field.access?.[op] : undefined
  return fn ? fn({ req, data: {}, siblingData: {} } as never) : true
}

const CONTENT = [
  'shows',
  'performances',
  'venues',
  'archive',
  'people',
  'news',
  'reviews',
  'partners',
  'pages',
  'documents',
  'media',
]

describe('every CMS collection declares its access explicitly', () => {
  it.each(collections.map((c) => c.slug))('%s has create/read/update/delete', (slug) => {
    const c = bySlug(slug)
    for (const op of ['create', 'read', 'update', 'delete'] as const)
      expect(c.access?.[op], `${slug}.${op}`).toBeTypeOf('function')
  })
})

describe('cashier', () => {
  const cashier = staff('cashier')
  const req = reqOf(cashier)

  it.each(collections.filter((c) => c.slug !== 'admin-users').map((c) => c.slug))(
    'cannot create, update or delete %s',
    async (slug) => {
      for (const op of OPS) expect(await can(bySlug(slug), op, req), `${slug}.${op}`).toBe(false)
    },
  )

  it('cannot change prices or quotas', async () => {
    for (const op of OPS) expect(await can(bySlug('ticket-types'), op, req)).toBe(false)
    expect(fieldCan(bySlug('performances'), 'seating', 'update', req)).toBe(false)
  })

  it('cannot change site settings', () => {
    expect(SiteSettings.access?.update?.({ req } as never)).toBe(false)
  })

  it('cannot create staff or change any role, including their own', async () => {
    expect(await can(AdminUsers, 'create', req)).toBe(false)
    expect(await can(AdminUsers, 'delete', req)).toBe(false)
    // Обновлять может только свою запись (пароль), а поле роли закрыто.
    expect(await can(AdminUsers, 'update', req)).toEqual({ id: { equals: cashier.id } })
    expect(fieldCan(AdminUsers, 'role', 'update', req)).toBe(false)
    expect(fieldCan(AdminUsers, 'systemAdmin', 'update', req)).toBe(false)
    expect(fieldCan(AdminUsers, 'mfaEnabled', 'update', req)).toBe(false)
  })

  it('sees only their own staff record', async () => {
    expect(await AdminUsers.access!.read!({ req } as never)).toEqual({
      id: { equals: cashier.id },
    })
  })
})

describe('content editor', () => {
  const req = reqOf(staff('editor'))

  it.each(CONTENT.filter((s) => s !== 'performances'))('edits %s', async (slug) => {
    for (const op of OPS) expect(await can(bySlug(slug), op, req), `${slug}.${op}`).toBe(true)
  })

  it('schedules performances but cannot touch sales window, seating or seat prices', async () => {
    expect(await can(bySlug('performances'), 'create', req)).toBe(true)
    expect(await can(bySlug('performances'), 'update', req)).toBe(true)
    expect(await can(bySlug('performances'), 'delete', req)).toBe(false)
    for (const field of ['seating', 'salesStartAt', 'salesEndAt'])
      expect(fieldCan(bySlug('performances'), field, 'update', req), field).toBe(false)
  })

  it('cannot touch sales (ticket prices and quotas) or settings', async () => {
    for (const op of OPS) expect(await can(bySlug('ticket-types'), op, req)).toBe(false)
    expect(SiteSettings.access?.update?.({ req } as never)).toBe(false)
  })

  it('cannot manage staff or roles', async () => {
    expect(await can(AdminUsers, 'create', req)).toBe(false)
    expect(fieldCan(AdminUsers, 'role', 'update', req)).toBe(false)
  })
})

describe('theatre admin', () => {
  const admin = staff('admin')

  it('with the second factor: prices, quotas, settings and staff', async () => {
    const req = reqOf(admin)
    for (const op of OPS) expect(await can(bySlug('ticket-types'), op, req)).toBe(true)
    expect(SiteSettings.access?.update?.({ req } as never)).toBe(true)
    expect(fieldCan(bySlug('performances'), 'seating', 'update', req)).toBe(true)
    expect(await can(AdminUsers, 'create', req)).toBe(true)
    expect(fieldCan(AdminUsers, 'role', 'update', req)).toBe(true)
  })

  it('with only a password: no more rights than an anonymous visitor', async () => {
    const req = reqOf(admin, { mfa: false })
    for (const c of collections.filter((c) => c.slug !== 'admin-users'))
      for (const op of OPS) expect(await can(c, op, req), `${c.slug}.${op}`).toBe(false)
    expect(SiteSettings.access?.update?.({ req } as never)).toBe(false)
    expect(bySlug('shows').access!.read!({ req } as never)).toEqual({
      _status: { equals: 'published' },
    })
    expect(bySlug('shows').access!.readVersions!({ req } as never)).toBe(false)
  })

  it('MFA secrets are closed to everyone, admins included', async () => {
    const req = reqOf(staff('admin', { systemAdmin: true }))
    for (const slug of ['admin-mfa', 'admin-mfa-recovery-codes'])
      for (const op of ['create', 'read', 'update', 'delete'] as const)
        expect(await bySlug(slug).access![op]!({ req } as never)).toBe(false)
  })
})

describe('public visitor', () => {
  const req = reqOf(null)
  it.each(CONTENT.filter((s) => s !== 'media'))('reads only published %s', async (slug) => {
    expect(await bySlug(slug).access!.read!({ req } as never)).toEqual({
      _status: { equals: 'published' },
    })
    for (const op of OPS) expect(await can(bySlug(slug), op, req)).toBe(false)
  })
})

describe('role escalation guard', () => {
  const run = (
    req: PayloadRequest,
    data: Record<string, unknown>,
    originalDoc?: Partial<StaffUser>,
    operation: 'create' | 'update' = originalDoc ? 'update' : 'create',
  ) => guardRoleChanges({ data, operation, originalDoc, req, context: {} } as never)

  it('makes the very first staff member a system admin', async () => {
    expect(
      await run(reqOf(null, { totalUsers: 0 }), { email: 'a@b.ru', role: 'cashier' }),
    ).toMatchObject({
      role: 'admin',
      systemAdmin: true,
    })
  })

  it('a theatre admin manages cashiers and editors but cannot appoint an admin', async () => {
    const req = reqOf(staff('admin'))
    expect(await run(req, { role: 'editor' })).toMatchObject({ role: 'editor' })
    await expect(run(req, { role: 'admin' })).rejects.toBeInstanceOf(Forbidden)
    await expect(run(req, { role: 'admin' }, { id: 99, role: 'editor' })).rejects.toBeInstanceOf(
      Forbidden,
    )
  })

  it('a theatre admin cannot edit another admin account', async () => {
    const req = reqOf(staff('admin'))
    await expect(run(req, { name: 'x' }, { id: 99, role: 'admin' })).rejects.toBeInstanceOf(
      Forbidden,
    )
    await expect(guardUserDelete({ id: 99, req } as never)).rejects.toBeInstanceOf(Forbidden)
  })

  it('a system admin (flag or CMS_SYSTEM_ADMIN_EMAILS) appoints admins', async () => {
    expect(
      await run(reqOf(staff('admin', { systemAdmin: true })), { role: 'admin' }),
    ).toMatchObject({ role: 'admin' })
    const byEmail = staff('admin', { email: 'root@example.com' })
    expect(await run(reqOf(byEmail), { role: 'admin' }, { id: 99, role: 'cashier' })).toMatchObject(
      { role: 'admin' },
    )
  })

  it('an admin without the second factor cannot appoint anyone', async () => {
    // Поле роли закрыто, а хук считает его анонимным сотрудником без прав системного админа.
    const req = reqOf(staff('admin'), { mfa: false })
    expect(fieldCan(AdminUsers, 'role', 'update', req)).toBe(false)
    await expect(run(req, { role: 'admin' })).rejects.toBeInstanceOf(Forbidden)
  })
})

describe('audit of staff changes (commerce_audit_log)', () => {
  const entries: CmsAuditEntry[] = []
  const hook = auditUserChange(async (_req, entry) => {
    entries.push(entry)
  })
  const req = reqOf(staff('admin', { systemAdmin: true }))

  it('records creation, role changes and changed fields without their values', async () => {
    entries.length = 0
    await hook({
      doc: { id: 5, role: 'cashier', email: 'c@x.ru' },
      operation: 'create',
      req,
      data: {},
    } as never)
    await hook({
      doc: { id: 5, role: 'editor', email: 'new@x.ru' },
      previousDoc: { id: 5, role: 'cashier', email: 'c@x.ru' },
      operation: 'update',
      req,
      data: { password: 'secret-pass' },
    } as never)
    expect(entries).toEqual([
      {
        action: 'cms.user.create',
        entity: 'admin-users',
        entityId: '5',
        result: 'ok',
        reason: 'role: cashier',
      },
      {
        action: 'cms.user.role_change',
        entity: 'admin-users',
        entityId: '5',
        result: 'ok',
        reason: 'cashier → editor',
      },
      {
        action: 'cms.user.update',
        entity: 'admin-users',
        entityId: '5',
        result: 'ok',
        reason: 'email, password',
      },
    ])
    expect(JSON.stringify(entries)).not.toContain('new@x.ru')
    expect(JSON.stringify(entries)).not.toContain('secret-pass')
  })
})
