import { randomBytes, randomUUID } from 'node:crypto'

import type { Logger } from '@/lib/log'
import type { CommerceStore, OrderRow, TicketRow } from '@/modules/inventory/store'
import { refundAmounts } from '@/modules/refunds/amounts'
import {
  assessClaim,
  CLAIM_REASON_LABELS,
  CLAIM_REASONS,
  DOCUMENT_DAYS_AFTER,
  endOfTheatreDay,
  type ClaimAssessment,
  type ClaimReason,
} from '@/modules/refunds/claims-policy'
import type { RefundPolicy } from '@/modules/refunds/policy'
import type { RefundActor, RefundRequestResult } from '@/modules/refunds/service'

import { MAX_FILE_BYTES, MAX_FILES_PER_CLAIM, sniffMime, type ClaimFileStorage } from './files'
import type { ClaimFileRow, ClaimRow, ClaimStatus, ClaimStore } from './store'

/**
 * Заявки зрителей на возврат (ст. 52.1 Закона о культуре, ПП № 1491). Зритель подаёт заявку в
 * кабинете: причина, комментарий, документы. Система считает, что положено по закону, но деньги не
 * трогает — каждую заявку решает сотрудник в админке: одобряет с процентом (создаётся обычный
 * возврат через банк) или отказывает с объяснением.
 */

const MAX_TICKETS = 20
const COMMENT_MAX = 1000
const DECISION_MIN = 3
const LIST_LIMIT = 50
const DAY_MS = 24 * 60 * 60_000

export type ClaimError =
  | 'NOT_FOUND'
  | 'INVALID_REASON'
  | 'COMMENT_TOO_LONG'
  /** Билет не действует, заказ не оплачен или уже возвращается. */
  | 'NOT_REFUNDABLE'
  /** По этим билетам уже есть открытая заявка. */
  | 'ALREADY_CLAIMED'
  /** День спектакля прошёл — заявку подать нельзя. */
  | 'TOO_LATE'
  | 'SHOW_TIME_UNKNOWN'
  /** Заявка уже решена или отменена. */
  | 'CLOSED'
  | 'FILE_TYPE'
  | 'FILE_TOO_LARGE'
  | 'TOO_MANY_FILES'
  /** Срок для документов (14 дней после спектакля) прошёл. */
  | 'DOCUMENT_DEADLINE'
  | 'INVALID_PERCENT'
  | 'DECISION_COMMENT'
  /** Возврат через банк не оформился (код ошибки — в `refundError`). */
  | 'REFUND_FAILED'

export type ClaimQuote = {
  orderNumber: string
  ticketNumbers: string[]
  showTitle: string | null
  startsAt: Date
  assessment: ClaimAssessment
  /** Что вернётся при решении «по закону» (0 — по закону не положено). */
  amounts: { cashKopecks: number; bonusKopecks: number; feeKopecks: number }
  /** Сбор, который не возвращается. */
  feeKeptKopecks: number
}

export type ClaimView = {
  id: string
  number: string
  status: ClaimStatus
  orderNumber: string
  ticketNumbers: string[]
  reason: ClaimReason
  reasonLabel: string
  comment: string | null
  startsAt: Date
  legalPercent: number
  basis: string
  includeFee: boolean
  documentRequired: boolean
  documentDeadline: Date | null
  /** До какого момента можно досылать файлы. */
  filesUntil: Date
  files: { id: string; name: string; mimeType: string; sizeBytes: number; uploadedAt: Date }[]
  decidedPercent: number | null
  decisionComment: string | null
  decidedBy: string | null
  decidedAt: Date | null
  refundId: string | null
  createdAt: Date
}

export type StaffClaimView = ClaimView & {
  customerEmail: string | null
  showTitle: string | null
  /** Что вернётся при решении «по закону» (подсказка сотруднику). */
  legalAmounts: { cashKopecks: number; bonusKopecks: number; feeKopecks: number }
  /** Доли билетов (деньги без сбора, бонусы, сбор) — админка пересчитывает сумму при другом %. */
  ticketAmounts: { cashKopecks: number; bonusKopecks: number; feeKopecks: number }[]
}

type Result<T> = { ok: true; value: T } | { ok: false; error: ClaimError; refundError?: string }

type Deps = {
  claims: ClaimStore
  commerce: CommerceStore
  files: ClaimFileStorage
  policy: () => Promise<RefundPolicy>
  /** Возврат денег по одобренной заявке — обычный возврат сотрудником. */
  staffRefund: (input: {
    staff: Extract<RefundActor, { kind: 'staff' }>
    orderNumber: string
    ticketNumbers: string[]
    reason: string
    includeFee: boolean
    percent: number
    clientKey: string
  }) => Promise<RefundRequestResult>
  /** Акционный ли тип билета (отметка в CMS). */
  isPromo: (performanceId: string, ticketTypeId: string) => boolean | Promise<boolean>
  /** Начало и название показа из афиши (для старых позиций без снимка). */
  performance: (
    performanceId: string,
  ) =>
    | Promise<{ startsAt: Date; showTitle: string } | null>
    | { startsAt: Date; showTitle: string }
    | null
  customerEmail?: (customerId: string) => Promise<string | null>
  timeZone: string
  log: Logger
  now?: () => Date
}

const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const err = <T>(error: ClaimError, refundError?: string): Result<T> => ({
  ok: false,
  error,
  refundError,
})

const claimNumber = () => `ВЗ-${randomBytes(4).toString('hex').toUpperCase()}`

const isReason = (v: unknown): v is ClaimReason =>
  typeof v === 'string' && (CLAIM_REASONS as readonly string[]).includes(v)

export function createClaimService(deps: Deps) {
  const { claims, commerce } = deps
  const now = deps.now ?? (() => new Date())

  /** Начало самого раннего показа и его название: снимок позиции, иначе афиша. */
  const showOf = async (order: OrderRow, tickets: readonly TicketRow[]) => {
    const items = await commerce.items(order.id)
    let startsAt: Date | null = null
    let showTitle: string | null = null
    for (const t of tickets) {
      const item = items.find((i) => i.id === t.orderItemId)
      const info = await deps.performance(t.performanceId)
      const start = item?.startsAtSnapshot ?? info?.startsAt ?? null
      if (!start) return null
      if (!startsAt || start < startsAt) {
        startsAt = start
        showTitle = item?.showTitleSnapshot ?? info?.showTitle ?? null
      }
    }
    return startsAt ? { startsAt, showTitle } : null
  }

  /** Билеты покупателя по номерам — из одного его заказа; чужие и неизвестные неразличимы. */
  const customerTickets = async (customerId: string, numbers: readonly string[]) => {
    if (!numbers.length || numbers.length > MAX_TICKETS) return null
    const tickets: TicketRow[] = []
    for (const n of new Set(numbers)) {
      const t = await commerce.ticketByNumber(n)
      if (!t) return null
      tickets.push(t)
    }
    const order = await commerce.order(tickets[0]!.orderId)
    if (!order || order.customerId !== customerId) return null
    if (tickets.some((t) => t.orderId !== order.id)) return null
    return { order, tickets }
  }

  const anyPromo = async (tickets: readonly TicketRow[]) => {
    for (const t of tickets) if (await deps.isPromo(t.performanceId, t.ticketTypeId)) return true
    return false
  }

  const amountsFor = (
    tickets: readonly TicketRow[],
    a: Pick<ClaimAssessment, 'percent' | 'includeFee'>,
  ) => {
    const fee = tickets.reduce((n, t) => n + t.feeKopecks, 0)
    if (a.percent === 0)
      return { amounts: { cashKopecks: 0, bonusKopecks: 0, feeKopecks: 0 }, feeKept: fee }
    const r = refundAmounts(tickets, { includeFee: a.includeFee, percent: a.percent })
    return {
      amounts: {
        cashKopecks: r.cashKopecks,
        bonusKopecks: r.bonusKopecks,
        feeKopecks: r.feeKopecks,
      },
      feeKept: a.includeFee ? 0 : fee,
    }
  }

  const filesUntil = (c: Pick<ClaimRow, 'documentDeadline' | 'startsAt'>) =>
    c.documentDeadline ??
    new Date(endOfTheatreDay(c.startsAt, deps.timeZone).getTime() + DOCUMENT_DAYS_AFTER * DAY_MS)

  const view = async (c: ClaimRow, order?: OrderRow | null): Promise<ClaimView> => {
    const [ids, files, o] = await Promise.all([
      claims.ticketIds(c.id),
      claims.files(c.id),
      order ? Promise.resolve(order) : commerce.order(c.orderId),
    ])
    const tickets = o ? (await commerce.tickets(o.id)).filter((t) => ids.includes(t.id)) : []
    return {
      id: c.id,
      number: c.number,
      status: c.status,
      orderNumber: o?.number ?? '',
      ticketNumbers: tickets.map((t) => t.number).sort(),
      reason: c.reason,
      reasonLabel: CLAIM_REASON_LABELS[c.reason],
      comment: c.comment,
      startsAt: c.startsAt,
      legalPercent: c.legalPercent,
      basis: c.basis,
      includeFee: c.includeFee,
      documentRequired: c.documentRequired,
      documentDeadline: c.documentDeadline,
      filesUntil: filesUntil(c),
      files: files.map((f) => ({
        id: f.id,
        name: f.originalName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        uploadedAt: f.uploadedAt,
      })),
      decidedPercent: c.decidedPercent,
      decisionComment: c.decisionComment,
      decidedBy: c.decidedBy,
      decidedAt: c.decidedAt,
      refundId: c.refundId,
      createdAt: c.createdAt,
    }
  }

  /** Что положено по заявке с такой причиной — до подачи (кабинет показывает сумму и правила). */
  async function quote(
    customerId: string,
    ticketNumbers: readonly string[],
    reason: ClaimReason,
  ): Promise<Result<ClaimQuote>> {
    if (!isReason(reason)) return err('INVALID_REASON')
    const found = await customerTickets(customerId, ticketNumbers)
    if (!found) return err('NOT_FOUND')
    const show = await showOf(found.order, found.tickets)
    if (!show) return err('SHOW_TIME_UNKNOWN')
    const policy = await deps.policy()
    const assessment = assessClaim({
      startsAt: show.startsAt,
      now: now(),
      reason,
      promo: await anyPromo(found.tickets),
      tiers: policy,
      timeZone: deps.timeZone,
    })
    const { amounts, feeKept } = amountsFor(found.tickets, assessment)
    return ok({
      orderNumber: found.order.number,
      ticketNumbers: found.tickets.map((t) => t.number).sort(),
      showTitle: show.showTitle,
      startsAt: show.startsAt,
      assessment,
      amounts,
      feeKeptKopecks: feeKept,
    })
  }

  /** Подать заявку (POST /api/account/refund-claims). Одна открытая заявка на билет. */
  async function submit(input: {
    customerId: string
    ticketNumbers: string[]
    reason: ClaimReason
    comment?: string | null
  }): Promise<Result<ClaimView>> {
    if (!isReason(input.reason)) return err('INVALID_REASON')
    const comment = input.comment?.trim() || null
    if (comment && comment.length > COMMENT_MAX) return err('COMMENT_TOO_LONG')
    const found = await customerTickets(input.customerId, input.ticketNumbers)
    if (!found) return err('NOT_FOUND')
    const { order, tickets } = found
    if (order.status !== 'PAID' && order.status !== 'PARTIALLY_REFUNDED')
      return err('NOT_REFUNDABLE')
    if (tickets.some((t) => t.status !== 'ISSUED')) return err('NOT_REFUNDABLE')
    for (const t of tickets) if (await claims.openClaimOfTicket(t.id)) return err('ALREADY_CLAIMED')
    const show = await showOf(order, tickets)
    if (!show) return err('SHOW_TIME_UNKNOWN')
    const at = now()
    const policy = await deps.policy()
    const a = assessClaim({
      startsAt: show.startsAt,
      now: at,
      reason: input.reason,
      promo: await anyPromo(tickets),
      tiers: policy,
      timeZone: deps.timeZone,
    })
    if (!a.canSubmit) return err('TOO_LATE')
    const claim: ClaimRow = {
      id: randomUUID(),
      number: claimNumber(),
      orderId: order.id,
      customerId: input.customerId,
      reason: input.reason,
      comment,
      status: 'SUBMITTED',
      startsAt: show.startsAt,
      legalPercent: a.percent,
      basis: a.basis,
      includeFee: a.includeFee,
      documentRequired: a.documentRequired,
      documentDeadline: a.documentDeadline,
      decidedPercent: null,
      decisionComment: null,
      decidedBy: null,
      decidedAt: null,
      refundId: null,
      createdAt: at,
      updatedAt: at,
    }
    if (
      !(await claims.insertClaim(
        claim,
        tickets.map((t) => t.id),
      ))
    )
      return err('ALREADY_CLAIMED')
    deps.log.info('refund_claim.submitted', {
      claim: claim.number,
      order: order.number,
      reason: claim.reason,
      legalPercent: claim.legalPercent,
    })
    return ok(await view(claim, order))
  }

  async function listForCustomer(customerId: string) {
    const rows = await claims.claimsOfCustomer(customerId, LIST_LIMIT)
    return Promise.all(rows.map((c) => view(c)))
  }

  /** Загрузить документ к своей заявке (пока она не решена и не истёк срок). */
  async function addFile(input: {
    customerId: string
    claimId: string
    name: string
    bytes: Buffer
  }): Promise<Result<ClaimFileRow>> {
    const c = await claims.claim(input.claimId)
    if (!c || c.customerId !== input.customerId) return err('NOT_FOUND')
    if (c.status !== 'SUBMITTED') return err('CLOSED')
    if (now().getTime() > filesUntil(c).getTime()) return err('DOCUMENT_DEADLINE')
    if (input.bytes.length === 0 || input.bytes.length > MAX_FILE_BYTES)
      return err('FILE_TOO_LARGE')
    const mime = sniffMime(input.bytes)
    if (!mime) return err('FILE_TYPE')
    if ((await claims.files(c.id)).length >= MAX_FILES_PER_CLAIM) return err('TOO_MANY_FILES')
    const storageKey = await deps.files.save(input.bytes, mime)
    const file: ClaimFileRow = {
      id: randomUUID(),
      claimId: c.id,
      // Имя — только для показа сотруднику; на диске файл под случайным ключом.
      originalName: input.name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200) || 'документ',
      mimeType: mime,
      sizeBytes: input.bytes.length,
      storageKey,
      uploadedAt: now(),
    }
    await claims.insertFile(file)
    deps.log.info('refund_claim.file_added', { claim: c.number, mime, size: file.sizeBytes })
    return ok(file)
  }

  /** Зритель отзывает свою заявку (передумал возвращать). */
  async function cancel(customerId: string, claimId: string): Promise<Result<ClaimView>> {
    const c = await claims.claim(claimId)
    if (!c || c.customerId !== customerId) return err('NOT_FOUND')
    const at = now()
    const done = await claims.decide(
      c.id,
      {
        status: 'CANCELLED',
        decidedPercent: null,
        decisionComment: null,
        decidedBy: null,
        decidedAt: null,
        refundId: null,
      },
      at,
    )
    if (!done) return err('CLOSED')
    return ok(await view((await claims.claim(c.id))!))
  }

  // --- Сотрудник ---

  const staffView = async (c: ClaimRow): Promise<StaffClaimView> => {
    const order = await commerce.order(c.orderId)
    const base = await view(c, order)
    const ids = await claims.ticketIds(c.id)
    const tickets = order
      ? (await commerce.tickets(order.id)).filter((t) => ids.includes(t.id))
      : []
    const show = order && tickets.length ? await showOf(order, tickets) : null
    return {
      ...base,
      customerEmail: deps.customerEmail ? await deps.customerEmail(c.customerId) : null,
      showTitle: show?.showTitle ?? null,
      legalAmounts: amountsFor(tickets, { percent: c.legalPercent, includeFee: c.includeFee })
        .amounts,
      ticketAmounts: tickets.map((t) => ({
        cashKopecks: t.cashKopecks,
        bonusKopecks: t.bonusKopecks,
        feeKopecks: t.feeKopecks,
      })),
    }
  }

  /** Очередь: открытые заявки (старые сверху) и последние решённые. */
  async function listForStaff() {
    const [open, closed] = await Promise.all([
      claims.claimsByStatus(['SUBMITTED'], LIST_LIMIT),
      claims.claimsByStatus(['APPROVED', 'REJECTED', 'CANCELLED'], LIST_LIMIT),
    ])
    closed.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    return {
      open: await Promise.all(open.map(staffView)),
      closed: await Promise.all(closed.slice(0, 20).map(staffView)),
    }
  }

  /**
   * Одобрить: создать возврат через банк на `percent`% номинала (+ сбор, если `includeFee`).
   * Ключ возврата — от id заявки: повторное одобрение (двойной клик) не вернёт деньги дважды.
   */
  async function approve(input: {
    staff: Extract<RefundActor, { kind: 'staff' }>
    claimId: string
    percent: number
    includeFee: boolean
    comment?: string | null
  }): Promise<Result<StaffClaimView>> {
    if (!Number.isInteger(input.percent) || input.percent < 1 || input.percent > 100)
      return err('INVALID_PERCENT')
    const c = await claims.claim(input.claimId)
    if (!c) return err('NOT_FOUND')
    if (c.status !== 'SUBMITTED') return err('CLOSED')
    const order = await commerce.order(c.orderId)
    if (!order) return err('NOT_FOUND')
    const ids = await claims.ticketIds(c.id)
    const tickets = (await commerce.tickets(order.id)).filter((t) => ids.includes(t.id))
    const comment = input.comment?.trim().slice(0, COMMENT_MAX) || null
    const result = await deps.staffRefund({
      staff: input.staff,
      orderNumber: order.number,
      ticketNumbers: tickets.map((t) => t.number),
      reason: `Заявка ${c.number}: ${CLAIM_REASON_LABELS[c.reason]}, ${input.percent}%${comment ? ` — ${comment}` : ''}`,
      includeFee: input.includeFee,
      percent: input.percent,
      clientKey: `claim-${c.id}`,
    })
    if (!result.ok) return err('REFUND_FAILED', result.error)
    const at = now()
    await claims.decide(
      c.id,
      {
        status: 'APPROVED',
        decidedPercent: input.percent,
        decisionComment: comment,
        decidedBy: input.staff.email ?? input.staff.staffId,
        decidedAt: at,
        refundId: result.refund.id,
      },
      at,
    )
    deps.log.info('refund_claim.approved', { claim: c.number, percent: input.percent })
    return ok(await staffView((await claims.claim(c.id))!))
  }

  /** Отказать: обязательное объяснение — его увидит зритель. */
  async function reject(input: {
    staff: Extract<RefundActor, { kind: 'staff' }>
    claimId: string
    comment: string
  }): Promise<Result<StaffClaimView>> {
    const comment = input.comment.trim()
    if (comment.length < DECISION_MIN || comment.length > COMMENT_MAX)
      return err('DECISION_COMMENT')
    const c = await claims.claim(input.claimId)
    if (!c) return err('NOT_FOUND')
    const at = now()
    const done = await claims.decide(
      c.id,
      {
        status: 'REJECTED',
        decidedPercent: null,
        decisionComment: comment,
        decidedBy: input.staff.email ?? input.staff.staffId,
        decidedAt: at,
        refundId: null,
      },
      at,
    )
    if (!done) return err('CLOSED')
    deps.log.info('refund_claim.rejected', { claim: c.number })
    return ok(await staffView((await claims.claim(c.id))!))
  }

  /** Документ заявки для сотрудника (права проверяет вызывающий). */
  async function fileForStaff(fileId: string) {
    const f = await claims.file(fileId)
    if (!f) return null
    return { file: f, bytes: await deps.files.read(f.storageKey) }
  }

  return {
    quote,
    submit,
    listForCustomer,
    addFile,
    cancel,
    listForStaff,
    approve,
    reject,
    fileForStaff,
  }
}

export type ClaimService = ReturnType<typeof createClaimService>
