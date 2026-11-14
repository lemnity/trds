import { and, asc, desc, eq, inArray } from '@payloadcms/db-postgres/drizzle'
import type { NodePgDatabase } from '@payloadcms/db-postgres/drizzle/node-postgres'

import {
  commerceRefundClaimFiles,
  commerceRefundClaims,
  commerceRefundClaimTickets,
} from '@/db/schema/commerce'

import type { ClaimRow, ClaimStore } from './store'

type Db = NodePgDatabase<Record<string, never>>

/** Нарушение уникальности (билет уже в открытой заявке). */
const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === '23505'

const row = (r: typeof commerceRefundClaims.$inferSelect): ClaimRow => ({ ...r })

export function pgClaimStore(db: Db): ClaimStore {
  return {
    async insertClaim(claim, ticketIds) {
      try {
        await db.transaction(async (tx) => {
          await tx.insert(commerceRefundClaims).values(claim)
          await tx
            .insert(commerceRefundClaimTickets)
            .values(ticketIds.map((ticketId) => ({ claimId: claim.id, ticketId, open: true })))
        })
        return true
      } catch (e) {
        if (isUniqueViolation(e)) return false
        throw e
      }
    },
    async claim(id) {
      const [r] = await db
        .select()
        .from(commerceRefundClaims)
        .where(eq(commerceRefundClaims.id, id))
        .limit(1)
      return r ? row(r) : null
    },
    async ticketIds(claimId) {
      const rows = await db
        .select({ ticketId: commerceRefundClaimTickets.ticketId })
        .from(commerceRefundClaimTickets)
        .where(eq(commerceRefundClaimTickets.claimId, claimId))
      return rows.map((r) => r.ticketId)
    },
    async openClaimOfTicket(ticketId) {
      const [r] = await db
        .select({ claim: commerceRefundClaims })
        .from(commerceRefundClaimTickets)
        .innerJoin(
          commerceRefundClaims,
          eq(commerceRefundClaims.id, commerceRefundClaimTickets.claimId),
        )
        .where(
          and(
            eq(commerceRefundClaimTickets.ticketId, ticketId),
            eq(commerceRefundClaimTickets.open, true),
          ),
        )
        .limit(1)
      return r ? row(r.claim) : null
    },
    async claimsOfCustomer(customerId, limit) {
      const rows = await db
        .select()
        .from(commerceRefundClaims)
        .where(eq(commerceRefundClaims.customerId, customerId))
        .orderBy(desc(commerceRefundClaims.createdAt))
        .limit(limit)
      return rows.map(row)
    },
    async claimsByStatus(statuses, limit) {
      const rows = await db
        .select()
        .from(commerceRefundClaims)
        .where(inArray(commerceRefundClaims.status, [...statuses]))
        .orderBy(asc(commerceRefundClaims.createdAt))
        .limit(limit)
      return rows.map(row)
    },
    async decide(id, decision, at) {
      return db.transaction(async (tx) => {
        const updated = await tx
          .update(commerceRefundClaims)
          .set({ ...decision, updatedAt: at })
          .where(and(eq(commerceRefundClaims.id, id), eq(commerceRefundClaims.status, 'SUBMITTED')))
          .returning({ id: commerceRefundClaims.id })
        if (!updated.length) return false
        await tx
          .update(commerceRefundClaimTickets)
          .set({ open: false })
          .where(eq(commerceRefundClaimTickets.claimId, id))
        return true
      })
    },
    async insertFile(file) {
      await db.insert(commerceRefundClaimFiles).values(file)
    },
    async files(claimId) {
      return db
        .select()
        .from(commerceRefundClaimFiles)
        .where(eq(commerceRefundClaimFiles.claimId, claimId))
        .orderBy(asc(commerceRefundClaimFiles.uploadedAt))
    },
    async file(id) {
      const [r] = await db
        .select()
        .from(commerceRefundClaimFiles)
        .where(eq(commerceRefundClaimFiles.id, id))
        .limit(1)
      return r ?? null
    },
  }
}
