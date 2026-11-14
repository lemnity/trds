import type { ClaimReason } from '@/modules/refunds/claims-policy'
import type { CLAIM_STATUSES } from '@/db/schema/commerce'

export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

export type ClaimRow = {
  id: string
  number: string
  orderId: string
  customerId: string
  reason: ClaimReason
  comment: string | null
  status: ClaimStatus
  startsAt: Date
  legalPercent: number
  basis: string
  includeFee: boolean
  documentRequired: boolean
  documentDeadline: Date | null
  decidedPercent: number | null
  decisionComment: string | null
  decidedBy: string | null
  decidedAt: Date | null
  refundId: string | null
  createdAt: Date
  updatedAt: Date
}

export type ClaimFileRow = {
  id: string
  claimId: string
  originalName: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  uploadedAt: Date
}

export type ClaimDecision = Pick<
  ClaimRow,
  'status' | 'decidedPercent' | 'decisionComment' | 'decidedBy' | 'decidedAt' | 'refundId'
>

/** Хранилище заявок на возврат (PostgreSQL; в тестах и dev без базы — память). */
export interface ClaimStore {
  /** false — один из билетов уже в открытой заявке. */
  insertClaim(claim: ClaimRow, ticketIds: readonly string[]): Promise<boolean>
  claim(id: string): Promise<ClaimRow | null>
  ticketIds(claimId: string): Promise<string[]>
  /** Открытая заявка, в которой уже есть билет. */
  openClaimOfTicket(ticketId: string): Promise<ClaimRow | null>
  claimsOfCustomer(customerId: string, limit: number): Promise<ClaimRow[]>
  claimsByStatus(statuses: readonly ClaimStatus[], limit: number): Promise<ClaimRow[]>
  /** Условный переход из SUBMITTED; билеты заявки закрываются. false — уже решена. */
  decide(id: string, decision: ClaimDecision, at: Date): Promise<boolean>
  insertFile(file: ClaimFileRow): Promise<void>
  files(claimId: string): Promise<ClaimFileRow[]>
  file(id: string): Promise<ClaimFileRow | null>
}

export function memoryClaimStore(): ClaimStore {
  const claims = new Map<string, ClaimRow>()
  const tickets = new Map<string, { ticketId: string; open: boolean }[]>()
  const files = new Map<string, ClaimFileRow>()
  const copy = <T extends object>(v: T): T => ({ ...v })
  return {
    async insertClaim(claim, ticketIds) {
      for (const id of ticketIds)
        for (const list of tickets.values())
          if (list.some((t) => t.ticketId === id && t.open)) return false
      claims.set(claim.id, copy(claim))
      tickets.set(
        claim.id,
        ticketIds.map((ticketId) => ({ ticketId, open: true })),
      )
      return true
    },
    async claim(id) {
      const c = claims.get(id)
      return c ? copy(c) : null
    },
    async ticketIds(claimId) {
      return (tickets.get(claimId) ?? []).map((t) => t.ticketId)
    },
    async openClaimOfTicket(ticketId) {
      for (const [claimId, list] of tickets)
        if (list.some((t) => t.ticketId === ticketId && t.open)) return copy(claims.get(claimId)!)
      return null
    },
    async claimsOfCustomer(customerId, limit) {
      return [...claims.values()]
        .filter((c) => c.customerId === customerId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map(copy)
    },
    async claimsByStatus(statuses, limit) {
      return [...claims.values()]
        .filter((c) => statuses.includes(c.status))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, limit)
        .map(copy)
    },
    async decide(id, decision, at) {
      const c = claims.get(id)
      if (!c || c.status !== 'SUBMITTED') return false
      claims.set(id, { ...c, ...decision, updatedAt: at })
      for (const t of tickets.get(id) ?? []) t.open = false
      return true
    },
    async insertFile(file) {
      files.set(file.id, copy(file))
    },
    async files(claimId) {
      return [...files.values()]
        .filter((f) => f.claimId === claimId)
        .sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime())
        .map(copy)
    },
    async file(id) {
      const f = files.get(id)
      return f ? copy(f) : null
    },
  }
}
