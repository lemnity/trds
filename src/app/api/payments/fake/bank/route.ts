import type { NextRequest } from 'next/server'

import { log } from '@/lib/log'
import { formatRub } from '@/lib/money'
import { getDevBank, type FakeBank } from '@/modules/orders'

export const dynamic = 'force-dynamic'

/**
 * Учебный банк — только разработка (PAYMENT_PROVIDER=fake, не production; на превью маршрутов
 * API нет вовсе). Страница оплаты по адресу из `createPayment`, кнопки — как исходы настоящей
 * оплаты, после решения — подписанное уведомление на /api/payments/webhook/fake и возврат
 * на сайт. «Без уведомления» проверяет сверку по потерянному webhook, «позже» — оплату после
 * истечения брони (бронь можно укоротить: CHECKOUT_HOLD_TTL_SECONDS).
 */

const ACTIONS = ['pay', 'decline', 'silent', 'late'] as const
type Action = (typeof ACTIONS)[number]

const notFound = () => new Response('Not found', { status: 404 })

const devBank = (): FakeBank | null => (process.env.NODE_ENV === 'production' ? null : getDevBank())

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

/** Уведомление банка — настоящим HTTP-запросом, как его прислал бы банк. */
const deliver = async (bank: FakeBank, paymentId: string, origin: string) => {
  const notification = bank.notification(paymentId)
  if (!notification) return false
  try {
    const res = await fetch(new URL('/api/payments/webhook/fake', origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...notification.headers },
      body: notification.rawBody,
      signal: AbortSignal.timeout(10_000),
    })
    log.info('fake_bank.webhook_sent', { status: res.status })
    return res.ok
  } catch {
    log.warn('fake_bank.webhook_failed')
    return false
  }
}

const page = (body: string) =>
  new Response(
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Учебный банк</title><style>
body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f4f1ea;color:#1d1b18}
main{max-width:30rem;margin:3rem auto;padding:1.5rem;background:#fff;border-radius:12px;box-shadow:0 1px 4px #0002}
h1{font-size:1.25rem;margin:0 0 .25rem}.warn{background:#fff3cd;padding:.5rem .75rem;border-radius:8px;font-size:.875rem}
.sum{font-size:2rem;font-weight:700;margin:1rem 0}form{display:grid;gap:.5rem;margin-top:1rem}
button{font:inherit;padding:.75rem 1rem;border-radius:8px;border:1px solid #1d1b18;background:#fff;cursor:pointer;text-align:left}
button.primary{background:#1d1b18;color:#fff}button:focus-visible{outline:3px solid #b8860b;outline-offset:2px}
label{font-size:.875rem}select{font:inherit;padding:.25rem}
</style></head><body><main>${body}</main></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  )

/** GET /api/payments/fake/bank?payment=<id> — страница оплаты учебного банка. */
export async function GET(req: NextRequest) {
  const bank = devBank()
  if (!bank) return notFound()
  const id = req.nextUrl.searchParams.get('payment') ?? ''
  const payment = bank.payment(id)
  if (!payment) return notFound()
  const decided = payment.status !== 'pending'
  return page(`
<p class="warn">Учебный банк для разработки. Настоящие деньги не списываются.</p>
<h1>${escape(payment.description)}</h1>
<p class="sum">${escape(formatRub(payment.amountKopecks))}</p>
${
  decided
    ? `<p>Платёж уже ${payment.status === 'succeeded' ? 'оплачен' : 'отклонён'}.</p><p><a href="${escape(payment.returnUrl)}">Вернуться на сайт</a></p>`
    : `<form method="post">
<input type="hidden" name="payment" value="${escape(payment.id)}">
<button class="primary" name="action" value="pay">Оплатить</button>
<button name="action" value="decline">Отклонить платёж</button>
<button name="action" value="silent">Оплатить без уведомления (webhook потерян)</button>
<label>Задержка оплаты <select name="delay"><option value="30">30 с</option><option value="120">2 мин</option><option value="960">16 мин (после брони)</option></select></label>
<button name="action" value="late">Оплатить позже</button>
</form>`
}`)
}

/** POST — решение «покупателя»: исход платежа, уведомление и возврат на сайт. */
export async function POST(req: NextRequest) {
  const bank = devBank()
  if (!bank) return notFound()
  const form = await req.formData().catch(() => null)
  const id = String(form?.get('payment') ?? '')
  const action = String(form?.get('action') ?? '') as Action
  const payment = bank.payment(id)
  if (!payment || !ACTIONS.includes(action)) return notFound()
  const origin = req.nextUrl.origin

  if (action === 'late') {
    const delay = Math.min(Math.max(Number(form?.get('delay')) || 30, 1), 3600)
    // Процесс dev-сервера живёт дольше запроса: «банк» досылает оплату позже.
    setTimeout(() => {
      bank.decide(id, 'succeeded')
      void deliver(bank, id, origin)
    }, delay * 1000)
  } else {
    bank.decide(id, action === 'decline' ? 'canceled' : 'succeeded')
    if (action !== 'silent') await deliver(bank, id, origin)
  }
  return Response.redirect(payment.returnUrl, 303)
}
