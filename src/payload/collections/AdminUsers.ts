import {
  Forbidden,
  type CollectionAfterChangeHook,
  type CollectionAfterDeleteHook,
  type CollectionAfterLoginHook,
  type CollectionBeforeChangeHook,
  type CollectionBeforeDeleteHook,
  type CollectionConfig,
} from 'payload'

import {
  ADMIN_USERS_SLUG,
  ROLE_LABELS,
  STAFF_ROLES,
  activeStaff,
  canOpenAdmin,
  fieldNobody,
  fieldTheatreAdmins,
  isSystemAdmin,
  theatreAdmins,
  type StaffUser,
} from '../access/roles'
import { writeCmsAudit, type CmsAuditWriter } from '../audit'
import { mfaEndpoints } from '../auth/endpoints'
import { ADMIN_MFA_CODES_SLUG, ADMIN_MFA_SLUG } from '../auth/mfaStore'

/**
 * Сотрудники CMS (T-023). Роли и права — src/payload/access/roles.ts. Пределы администратора
 * театра: он ведёт кассиров и редакторов, но назначить, изменить или удалить администратора
 * может только системный администратор (первый сотрудник или CMS_SYSTEM_ADMIN_EMAILS).
 * Секреты MFA здесь не хранятся — только признак `mfaEnabled` (секреты в скрытой `admin-mfa`).
 */

type UserDoc = StaffUser & { name?: string | null }

const isPrivileged = (doc: Partial<UserDoc> | undefined) =>
  !!doc && (doc.role === 'admin' || doc.systemAdmin === true)

/** Эскалация прав — только системному администратору; первый сотрудник становится им сам. */
export const guardRoleChanges: CollectionBeforeChangeHook<UserDoc> = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (req.context?.mfaInternal) return data
  if (operation === 'create') {
    const { totalDocs } = await req.payload.count({
      collection: ADMIN_USERS_SLUG,
      overrideAccess: true,
      req,
    })
    if (totalDocs === 0) return { ...data, role: 'admin', systemAdmin: true }
  }
  // Local API без пользователя (сид, служебные скрипты) — доверенный серверный код.
  if (!req.user) return data
  const actor = activeStaff(req)
  if (isSystemAdmin(actor)) return data
  const grantsAdmin =
    data.role === 'admin' && (operation === 'create' || originalDoc?.role !== 'admin')
  const touchesOtherAdmin =
    operation === 'update' && isPrivileged(originalDoc) && originalDoc?.id !== actor?.id
  if (grantsAdmin || touchesOtherAdmin) throw new Forbidden(req.t)
  return data
}

export const guardUserDelete: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const actor = activeStaff(req)
  if (!req.user || isSystemAdmin(actor)) return
  if (String(actor?.id) === String(id)) throw new Forbidden(req.t)
  const target = (await req.payload.findByID({
    collection: ADMIN_USERS_SLUG,
    id,
    depth: 0,
    overrideAccess: true,
    req,
  })) as UserDoc
  if (isPrivileged(target)) throw new Forbidden(req.t)
}

const TRACKED = ['email', 'name', 'role'] as const

export const auditUserChange =
  (write: CmsAuditWriter = writeCmsAudit): CollectionAfterChangeHook<UserDoc> =>
  async ({ doc, previousDoc, operation, req, data }) => {
    if (req.context?.mfaInternal) return doc
    const entityId = String(doc.id)
    if (operation === 'create') {
      await write(req, {
        action: 'cms.user.create',
        entity: ADMIN_USERS_SLUG,
        entityId,
        result: 'ok',
        reason: `role: ${doc.role ?? '—'}`,
      })
      return doc
    }
    if (previousDoc?.role !== doc.role)
      await write(req, {
        action: 'cms.user.role_change',
        entity: ADMIN_USERS_SLUG,
        entityId,
        result: 'ok',
        reason: `${previousDoc?.role ?? '—'} → ${doc.role ?? '—'}`,
      })
    // Остальные изменения — только список полей, без значений (в них email).
    const changed = TRACKED.filter((f) => f !== 'role' && previousDoc?.[f] !== doc[f]) as string[]
    if (typeof (data as { password?: unknown }).password === 'string') changed.push('password')
    if (changed.length)
      await write(req, {
        action: 'cms.user.update',
        entity: ADMIN_USERS_SLUG,
        entityId,
        result: 'ok',
        reason: changed.join(', '),
      })
    return doc
  }

export const auditUserDelete =
  (write: CmsAuditWriter = writeCmsAudit): CollectionAfterDeleteHook =>
  async ({ id, req }) => {
    await write(req, {
      action: 'cms.user.delete',
      entity: ADMIN_USERS_SLUG,
      entityId: String(id),
      result: 'ok',
    })
  }

/** Удалённый сотрудник — удалить и его секреты MFA (иначе записи остались бы без владельца). */
export const removeUserMfa: CollectionAfterDeleteHook = async ({ id, req }) => {
  for (const collection of [ADMIN_MFA_CODES_SLUG, ADMIN_MFA_SLUG] as const)
    await req.payload.delete({
      collection,
      where: { user: { equals: id } },
      overrideAccess: true,
      req,
    })
}

export const auditLogin =
  (write: CmsAuditWriter = writeCmsAudit): CollectionAfterLoginHook =>
  async ({ req, user }) => {
    await write({ ...req, user: { ...user, collection: ADMIN_USERS_SLUG } } as typeof req, {
      action: 'cms.user.login',
      entity: ADMIN_USERS_SLUG,
      entityId: String(user.id),
      result: 'ok',
    })
  }

export const AdminUsers: CollectionConfig = {
  slug: ADMIN_USERS_SLUG,
  labels: { singular: 'Сотрудник', plural: 'Сотрудники' },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'role', 'mfaEnabled'],
    group: 'Администрирование',
  },
  auth: {
    // 2 часа сессии; 5 неверных паролей — блокировка на 15 минут.
    tokenExpiration: 7200,
    maxLoginAttempts: 5,
    lockTime: 15 * 60_000,
    cookies: { sameSite: 'Lax', secure: process.env.NODE_ENV === 'production' },
  },
  access: {
    admin: canOpenAdmin,
    // Себя видит любой сотрудник (нужно экрану MFA); всех — только администраторы.
    read: ({ req }) => {
      const user = req.user as StaffUser | null
      if (user?.collection !== ADMIN_USERS_SLUG) return false
      if (theatreAdmins({ req })) return true
      return { id: { equals: user.id } }
    },
    create: theatreAdmins,
    update: ({ req }) => {
      const user = activeStaff(req)
      if (!user) return false
      if (theatreAdmins({ req })) return true
      return { id: { equals: user.id } }
    },
    delete: theatreAdmins,
    unlock: theatreAdmins,
  },
  endpoints: mfaEndpoints(),
  hooks: {
    beforeChange: [guardRoleChanges],
    afterChange: [auditUserChange()],
    beforeDelete: [guardUserDelete],
    afterDelete: [removeUserMfa, auditUserDelete()],
    afterLogin: [auditLogin()],
  },
  fields: [
    { name: 'name', type: 'text', label: 'Имя' },
    {
      name: 'role',
      type: 'select',
      label: 'Роль',
      required: true,
      defaultValue: 'editor',
      options: STAFF_ROLES.map((value) => ({ value, label: ROLE_LABELS[value] })),
      access: { create: fieldTheatreAdmins, update: fieldTheatreAdmins },
      admin: {
        description:
          'Кассир — только просмотр; редактор — контент без цен и настроек; администратор — всё, кроме назначения администраторов.',
      },
    },
    {
      name: 'systemAdmin',
      type: 'checkbox',
      label: 'Системный администратор',
      defaultValue: false,
      access: { create: fieldNobody, update: fieldNobody },
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'mfaEnabled',
      type: 'checkbox',
      label: 'Второй фактор включён',
      defaultValue: false,
      access: { create: fieldNobody, update: fieldNobody },
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Меняется только на экране «Второй фактор» (/admin/mfa).',
      },
    },
  ],
}
