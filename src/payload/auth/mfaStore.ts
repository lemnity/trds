import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

import { emptyMfaRecord, type MfaRecord, type MfaStore } from './mfa'

export const ADMIN_MFA_SLUG = 'admin-mfa'
export const ADMIN_MFA_CODES_SLUG = 'admin-mfa-recovery-codes'

type Executor = {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rowCount?: number | null }>
}

type MfaDoc = {
  id: number | string
  secret?: string | null
  pendingSecret?: string | null
  lastStep?: number | null
  failedAttempts?: number | null
  lockedUntil?: string | null
  enabledAt?: string | null
}

const toRecord = (doc: MfaDoc): MfaRecord => ({
  secret: doc.secret ?? null,
  pendingSecret: doc.pendingSecret ?? null,
  lastStep: doc.lastStep ?? null,
  failedAttempts: doc.failedAttempts ?? 0,
  lockedUntil: doc.lockedUntil ? new Date(doc.lockedUntil) : null,
  enabledAt: doc.enabledAt ? new Date(doc.enabledAt) : null,
})

const iso = (d: Date | null | undefined) =>
  d === undefined ? undefined : (d?.toISOString() ?? null)

const toData = ({ lockedUntil, enabledAt, ...rest }: Partial<MfaRecord>) => ({
  ...rest,
  ...(lockedUntil !== undefined && { lockedUntil: iso(lockedUntil) }),
  ...(enabledAt !== undefined && { enabledAt: iso(enabledAt) }),
})

/**
 * MFA-записи в скрытых коллекциях Payload (доступ к ним через API закрыт полностью — только
 * Local API с overrideAccess). Сравнение шага и погашение кода — одним условным UPDATE, чтобы
 * два параллельных запроса с одним кодом не прошли оба.
 */
export function payloadMfaStore(payload: Payload): MfaStore {
  const db = () => payload.db.drizzle as unknown as Executor
  const userId = (id: string) => Number(id)

  const findDoc = async (id: string) =>
    (
      await payload.find({
        collection: ADMIN_MFA_SLUG,
        where: { user: { equals: userId(id) } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
    ).docs[0] as MfaDoc | undefined

  return {
    async get(id) {
      const doc = await findDoc(id)
      return doc ? toRecord(doc) : null
    },
    async upsert(id, patch) {
      const doc = await findDoc(id)
      if (doc)
        await payload.update({
          collection: ADMIN_MFA_SLUG,
          id: doc.id,
          data: toData(patch),
          overrideAccess: true,
        })
      else
        await payload.create({
          collection: ADMIN_MFA_SLUG,
          data: { ...toData({ ...emptyMfaRecord(), ...patch }), user: userId(id) },
          overrideAccess: true,
        })
    },
    async advanceStep(id, step) {
      const result = await db().execute(
        sql`UPDATE "admin_mfa" SET "last_step" = ${step} WHERE "user_id" = ${userId(id)} AND ("last_step" IS NULL OR "last_step" < ${step})`,
      )
      return (result.rowCount ?? 0) === 1
    },
    async replaceRecoveryCodes(id, hashes) {
      await payload.delete({
        collection: ADMIN_MFA_CODES_SLUG,
        where: { user: { equals: userId(id) } },
        overrideAccess: true,
      })
      for (const hash of hashes)
        await payload.create({
          collection: ADMIN_MFA_CODES_SLUG,
          data: { user: userId(id), hash },
          overrideAccess: true,
        })
    },
    async consumeRecoveryCode(id, hash, at) {
      const result = await db().execute(
        sql`UPDATE "admin_mfa_recovery_codes" SET "used_at" = ${at.toISOString()} WHERE "user_id" = ${userId(id)} AND "hash" = ${hash} AND "used_at" IS NULL`,
      )
      return (result.rowCount ?? 0) === 1
    },
    async remainingRecoveryCodes(id) {
      const { totalDocs } = await payload.count({
        collection: ADMIN_MFA_CODES_SLUG,
        where: { and: [{ user: { equals: userId(id) } }, { usedAt: { exists: false } }] },
        overrideAccess: true,
      })
      return totalDocs
    },
    async remove(id) {
      await payload.delete({
        collection: ADMIN_MFA_CODES_SLUG,
        where: { user: { equals: userId(id) } },
        overrideAccess: true,
      })
      await payload.delete({
        collection: ADMIN_MFA_SLUG,
        where: { user: { equals: userId(id) } },
        overrideAccess: true,
      })
    },
  }
}
