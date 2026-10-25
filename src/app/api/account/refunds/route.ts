import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { apiError } from '@/lib/correlation'
import { sharedRateLimiter } from '@/lib/rate-limit'
import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'
import { getRefunds, type RefundSummary } from '@/modules/refunds'

import { clientIp, fail, guarded, json, sameOrigin } from '../../auth/http'

export const dynamic = 'force-dynamic'

// Возврат — денежная операция: немного попыток на покупателя и на адрес.
const byCustomer = sharedRateLimiter({
  name: 'account.refunds.customer',
  limit: 10,
  windowMs: 15 * 60_000,
})
const byIp = sharedRateLimiter({ name: 'account.refunds.ip', limit: 30, windowMs: 15 * 60_000 })

const TICKET = /^TRD-[A-Z0-9]{8}-\d{2}$/
const body = z.object({
  tickets: z.array(z.string().regex(TICKET)).min(1).max(20),
  /** Ключ попытки из диалога подтверждения: повтор (двойной клик) — тот же возврат. */
  clientKey: z.string().regex(/^[A-Za-z0-9-]{16,100}$/),
})

/** Для зрителя — только статус и суммы, без внутренних деталей банка. */
const view = (r: RefundSummary) => ({
  id: r.id,
  status: r.publicStatus,
  orderNumber: r.orderNumber,
  ticketNumbers: r.ticketNumbers,
  cashKopecks: r.cashKopecks,
  bonusKopecks: r.bonusKopecks,
  feeKopecks: r.feeKopecks,
  createdAt: r.createdAt.toISOString(),
  completedAt: r.completedAt?.toISOString() ?? null,
})

const session = async (req: NextRequest) => {
  const { auth } = await getAccounts()
  return auth.getSession(req.cookies.get(SESSION_COOKIE)?.value)
}

/**
 * GET /api/account/refunds?tickets=TRD-…-01,TRD-…-02 — предпросмотр возврата (T-052): что
 * вернётся (деньги, бонусы, удерживаемый сбор), до какого срока и можно ли вернуть сейчас; `block`
 * — почему нельзя (`DISABLED` — возврат через кассу театра). 200 / 401 / 404.
 */
export const GET = guarded('account.refunds.quote', async (req: NextRequest, ctx) => {
  const s = await session(req)
  if (!s) return fail.unauthorized(ctx)
  const numbers = (req.nextUrl.searchParams.get('tickets') ?? '').split(',').filter(Boolean)
  if (!numbers.length || numbers.length > 20 || !numbers.every((n) => TICKET.test(n)))
    return fail.invalid(ctx)
  const quote = await (await getRefunds()).quoteForCustomer(s.customer.id, numbers)
  if (!quote) return apiError(404, 'not_found', 'Билет не найден.', ctx.correlationId)
  return json({
    ...quote,
    deadline: quote.deadline?.toISOString() ?? null,
    pending: quote.pending ? view(quote.pending) : null,
  })
})

const ERRORS: Record<string, [number, string]> = {
  NOT_FOUND: [404, 'Билет не найден.'],
  INVALID_KEY: [400, 'Обновите страницу и повторите.'],
  IN_PROGRESS: [409, 'Возврат по этому билету уже обрабатывается.'],
  NOT_REFUNDABLE: [409, 'Этот билет вернуть нельзя.'],
  NOTHING_TO_REFUND: [409, 'Возвращать нечего.'],
  IDEMPOTENCY_CONFLICT: [409, 'Обновите страницу и повторите.'],
  PAYMENT_UNAVAILABLE: [503, 'Возврат на сайте сейчас недоступен. Обратитесь в кассу театра.'],
  BLOCKED: [422, 'Вернуть билет в кабинете нельзя по правилам театра.'],
}

/**
 * POST /api/account/refunds — возврат билетов зрителем (T-052). Тело: `{ tickets, clientKey }`.
 * Покупатель — только из сессии; билеты — только его. 200 `{ refund }` — статус `processing`
 * (банк ещё не подтвердил), `succeeded` или `failed`; повтор с тем же ключом — тот же возврат
 * (`duplicate: true`), второй раз деньги не уходят. Ошибки — `{code, message, correlationId}`:
 * 400 invalid; 401; 403; 404; 409 in_progress (+ `refund`) / not_refundable; 422 blocked
 * (+ `block`); 429; 503.
 */
export const POST = guarded('account.refunds.request', async (req: NextRequest, ctx) => {
  if (!sameOrigin(req)) return fail.forbidden(ctx)
  if (!(await byIp.hit(clientIp(req)))) return fail.tooMany(ctx, 15 * 60)
  const s = await session(req)
  if (!s) return fail.unauthorized(ctx)
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return fail.invalid(ctx)
  if (!(await byCustomer.hit(s.customer.id))) return fail.tooMany(ctx, 15 * 60)
  const result = await (
    await getRefunds()
  ).requestCustomerRefund({
    customerId: s.customer.id,
    ticketNumbers: parsed.data.tickets,
    clientKey: parsed.data.clientKey,
    correlationId: ctx.correlationId,
  })
  if (result.ok) {
    ctx.log.info('refund.requested', { refundId: result.refund.id, duplicate: result.duplicate })
    return json({ duplicate: result.duplicate, refund: view(result.refund) })
  }
  const [status, message] = ERRORS[result.error] ?? [409, 'Возврат недоступен.']
  return apiError(
    status,
    result.error.toLowerCase(),
    message,
    ctx.correlationId,
    {},
    {
      ...(result.block && { block: result.block }),
      ...(result.refund && { refund: view(result.refund) }),
    },
  )
})
