import type { Access, FieldAccess, PayloadRequest, Where } from 'payload'

import { MFA_COOKIE, mfaKeysFromEnv, readCookie, verifyMfaCookie } from '../auth/mfa'

/**
 * Роли сотрудников CMS (plan-main.md §7.1, T-023). Права проверяются здесь — в access layer
 * Payload, то есть и в REST/GraphQL/Local API, а не только скрытием кнопок в админке.
 *
 * - admin — администратор театра: контент, афиша, цены и лимиты, настройки сайта, сотрудники
 *   (кассиры и редакторы). Назначать и снимать администраторов не может.
 * - editor — редактор контента: спектакли, показы (без цен), люди, новости, отзывы, страницы,
 *   медиа. Не трогает продажи, цены и настройки.
 * - cashier — касса: просмотр в админке; ничего в CMS не меняет (возвраты — доменный слой).
 * - системный администратор — флаг `systemAdmin` (первый созданный сотрудник) или email из
 *   CMS_SYSTEM_ADMIN_EMAILS: всё, что может admin, плюс управление администраторами и сброс MFA.
 */
export const STAFF_ROLES = ['admin', 'editor', 'cashier'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: 'Администратор театра',
  editor: 'Редактор контента',
  cashier: 'Кассир',
}

export type StaffUser = {
  id: number | string
  email?: string | null
  role?: StaffRole | null
  systemAdmin?: boolean | null
  mfaEnabled?: boolean | null
  collection?: string
  /** id сессии Payload (заполняет JWT-стратегия). */
  _sid?: string
}

export const ADMIN_USERS_SLUG = 'admin-users'

type ReqLike = Pick<PayloadRequest, 'user' | 'headers'> & { context?: PayloadRequest['context'] }

const staffOf = (req: ReqLike): StaffUser | null => {
  const user = req.user as StaffUser | null | undefined
  return user && user.collection === ADMIN_USERS_SLUG ? user : null
}

const systemAdminEmails = () =>
  (process.env.CMS_SYSTEM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

export const isSystemAdmin = (user: StaffUser | null | undefined) =>
  !!user &&
  (user.systemAdmin === true ||
    (!!user.email && systemAdminEmails().includes(user.email.toLowerCase())))

/** MFA обязательна администраторам (rules.md §4) и всем, кто включил её сам. */
export const mfaRequired = (user: StaffUser) =>
  user.role === 'admin' || isSystemAdmin(user) || user.mfaEnabled === true

/** Второй фактор пройден в текущей сессии (подписанная cookie, привязанная к sid). */
export const mfaVerified = (req: ReqLike, user: StaffUser, now = new Date()) =>
  !!user._sid &&
  verifyMfaCookie(readCookie(req.headers?.get('cookie'), MFA_COOKIE), mfaKeysFromEnv().cookie, {
    userId: String(user.id),
    sid: user._sid,
    now,
  })

/**
 * Сотрудник с действующими правами: вошёл и, если MFA обязательна, прошёл второй фактор.
 * Без второго фактора у администратора прав не больше, чем у анонимного посетителя.
 */
export const activeStaff = (req: ReqLike): StaffUser | null => {
  const user = staffOf(req)
  if (!user) return null
  if (mfaRequired(user) && !mfaVerified(req, user)) return null
  return user
}

export const hasRole = (req: ReqLike, roles: readonly StaffRole[]) => {
  const user = activeStaff(req)
  if (!user) return false
  if (isSystemAdmin(user)) return true
  return !!user.role && roles.includes(user.role)
}

const PUBLISHED: Where = { _status: { equals: 'published' } }

// --- Доступы коллекций ---

export const anyone: Access = () => true
export const nobody: Access = () => false

/** Публично — только опубликованное; сотрудники видят и черновики. */
export const publishedOrStaff: Access = ({ req }) => (activeStaff(req) ? true : PUBLISHED)

export const isStaffAccess: Access = ({ req }) => !!activeStaff(req)
export const contentEditors: Access = ({ req }) => hasRole(req, ['admin', 'editor'])
export const theatreAdmins: Access = ({ req }) => hasRole(req, ['admin'])
export const systemAdmins: Access = ({ req }) => isSystemAdmin(activeStaff(req))

/** Вход в /admin: любой сотрудник (до второго фактора — только экран MFA). */
export const canOpenAdmin = ({ req }: { req: PayloadRequest }) => !!staffOf(req)

// --- Доступы полей ---

export const fieldTheatreAdmins: FieldAccess = ({ req }) => hasRole(req, ['admin'])
export const fieldNobody: FieldAccess = () => false

// --- Наборы доступов коллекций ---

/** Редакционный контент: публично — опубликованное; правят администратор и редактор. */
export const contentAccess = {
  read: publishedOrStaff,
  readVersions: isStaffAccess,
  create: contentEditors,
  update: contentEditors,
  delete: contentEditors,
}

/** Продажи (цены и квоты): правит только администратор театра. */
export const salesAccess = {
  read: anyone,
  create: theatreAdmins,
  update: theatreAdmins,
  delete: theatreAdmins,
}
