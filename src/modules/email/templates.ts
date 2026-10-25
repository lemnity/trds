import { formatRub } from '@/lib/money'

import type { EmailAttachment, EmailMessage } from './types'

/**
 * Шаблоны писем (T-047): билеты после оплаты, уведомление о возврате, ручная проверка заказа для
 * театра. Каждое письмо — HTML и текстовая версия (почтовые клиенты без HTML, доступность).
 * Все подставляемые значения экранируются. В письме зрителя — только его заказ: QR (токен без ПД),
 * номер билета, спектакль, площадка. Письмо театру — без данных покупателя: номер заказа и причина,
 * подробности — в админке под ролью.
 */

type Email = Omit<EmailMessage, 'to' | 'idempotencyKey'>

const BRAND = 'Модный театр TURDUS'

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Ссылка только http(s): значение пришло из конфигурации, но проверяем на границе. */
const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? escapeHtml(url) : '#')

const layout = (title: string, body: string) =>
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>` +
  `<body style="margin:0;padding:0;background:#f3f2ef;color:#0f1426;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">` +
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ef"><tr><td align="center" style="padding:24px 12px">` +
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px"><tr><td style="padding:28px 24px">` +
  `<p style="margin:0 0 16px;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#5b6070">${BRAND}</p>` +
  body +
  `</td></tr></table></td></tr></table></body></html>`

const h1 = (text: string) =>
  `<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25">${escapeHtml(text)}</h1>`
const p = (html: string) => `<p style="margin:0 0 12px">${html}</p>`
const button = (href: string, label: string) =>
  `<p style="margin:16px 0"><a href="${safeUrl(href)}" style="display:inline-block;padding:12px 20px;background:#1f3a8a;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:700">${escapeHtml(label)}</a></p>`

const amountsRows = (rows: [string, string][]) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:8px 0 16px;border-top:1px solid #d9d7d2">` +
  rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;color:#5b6070">${escapeHtml(label)}</td><td style="padding:6px 0;text-align:right;font-weight:700">${escapeHtml(value)}</td></tr>`,
    )
    .join('') +
  `</table>`

export type TicketsEmailInput = {
  orderNumber: string
  tickets: {
    number: string
    showTitle: string | null
    /** Уже отформатировано во времени театра: «20 ноября, пт, 19:00 (Екб)». */
    when: string | null
    venue: { title: string; address: string } | null
    category: string
    seat: string | null
    /** Картинка QR (PNG) — вложение внутри письма. */
    qrPng: Buffer
    /** Подписанная ссылка на QR — если почта не показывает картинки. */
    qrLink: string
  }[]
  amounts: { grossKopecks: number; bonusKopecks: number; feeKopecks: number; cashKopecks: number }
  accountUrl: string
}

/** Билеты после подтверждённой оплаты (заказ PAID). */
export function ticketsEmail(input: TicketsEmailInput): Email {
  const count = input.tickets.length
  const subject = `Билеты по заказу ${input.orderNumber} — ${BRAND}`
  const attachments: EmailAttachment[] = input.tickets.map((t, i) => ({
    filename: `${t.number}.png`,
    content: t.qrPng,
    contentType: 'image/png',
    cid: `qr-${i + 1}@turdus`,
  }))
  const amountRows: [string, string][] = [
    ['Билеты', formatRub(input.amounts.grossKopecks)],
    ...(input.amounts.bonusKopecks > 0
      ? [['Оплачено бонусами', `−${formatRub(input.amounts.bonusKopecks)}`] as [string, string]]
      : []),
    ...(input.amounts.feeKopecks > 0
      ? [['Сервисный сбор', formatRub(input.amounts.feeKopecks)] as [string, string]]
      : []),
    ['Оплачено', formatRub(input.amounts.cashKopecks)],
  ]

  const ticketHtml = input.tickets
    .map((t, i) => {
      const facts = [
        t.when && `<b>${escapeHtml(t.when)}</b>`,
        t.venue && `${escapeHtml(t.venue.title)}, ${escapeHtml(t.venue.address)}`,
        escapeHtml(t.seat ? `${t.category}, ${t.seat}` : t.category),
      ].filter(Boolean)
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;border:1px solid #d9d7d2;border-radius:12px"><tr>` +
        `<td style="padding:16px;vertical-align:top">` +
        `<p style="margin:0 0 4px;font-size:13px;color:#5b6070">Билет ${escapeHtml(t.number)}</p>` +
        `<p style="margin:0 0 8px;font-size:18px;font-weight:700">${escapeHtml(t.showTitle ?? 'Спектакль театра TURDUS')}</p>` +
        facts.map((f) => `<p style="margin:0 0 4px">${f}</p>`).join('') +
        `<p style="margin:8px 0 0;font-size:14px"><a href="${safeUrl(t.qrLink)}" style="color:#1f3a8a">Открыть QR-код</a></p>` +
        `</td><td style="padding:16px;width:168px;vertical-align:top" align="right">` +
        `<img src="cid:${attachments[i]!.cid}" width="160" height="160" alt="QR-код билета ${escapeHtml(t.number)}" style="display:block;width:160px;height:160px">` +
        `</td></tr></table>`
      )
    })
    .join('')

  const html = layout(
    subject,
    h1(count === 1 ? 'Ваш билет' : 'Ваши билеты') +
      p(
        `Заказ <b>${escapeHtml(input.orderNumber)}</b> оплачен. Покажите QR-код на входе — с экрана телефона или распечатанным.`,
      ) +
      ticketHtml +
      amountsRows(amountRows) +
      button(input.accountUrl, 'Билеты в личном кабинете') +
      p(
        `<span style="color:#5b6070;font-size:14px">Не пересылайте письмо: QR-код — это ваш билет. Если письмо пришло вам по ошибке, просто удалите его.</span>`,
      ),
  )

  const text = [
    `${count === 1 ? 'Ваш билет' : 'Ваши билеты'} — ${BRAND}`,
    '',
    `Заказ ${input.orderNumber} оплачен. Покажите QR-код на входе.`,
    '',
    ...input.tickets.flatMap((t) => [
      `Билет ${t.number}`,
      t.showTitle ?? 'Спектакль театра TURDUS',
      ...(t.when ? [t.when] : []),
      ...(t.venue ? [`${t.venue.title}, ${t.venue.address}`] : []),
      t.seat ? `${t.category}, ${t.seat}` : t.category,
      `QR-код: ${t.qrLink}`,
      '',
    ]),
    ...amountRows.map(([label, value]) => `${label}: ${value}`),
    '',
    `Билеты в личном кабинете: ${input.accountUrl}`,
    '',
    'Не пересылайте письмо: QR-код — это ваш билет.',
  ].join('\n')

  return { subject, text, html, attachments }
}

export type RefundEmailInput = {
  orderNumber: string
  ticketNumbers: string[]
  cashKopecks: number
  bonusKopecks: number
  /** true — банк подтвердил возврат; false — запрос принят и обрабатывается. */
  completed: boolean
  accountUrl: string
}

/**
 * Уведомление о возврате. Пока банк не подтвердил — «обрабатывается», не «деньги возвращены»
 * (design.md §9).
 */
export function refundEmail(input: RefundEmailInput): Email {
  const subject = input.completed
    ? `Возврат по заказу ${input.orderNumber} выполнен — ${BRAND}`
    : `Возврат по заказу ${input.orderNumber} обрабатывается — ${BRAND}`
  const lead = input.completed
    ? 'Банк подтвердил возврат. Деньги поступят на карту, с которой оплачен заказ; срок зачисления зависит от вашего банка.'
    : 'Мы приняли запрос на возврат и передали его в банк. Сообщим, когда банк подтвердит операцию.'
  const rows: [string, string][] = [
    ['Деньгами', formatRub(input.cashKopecks)],
    ...(input.bonusKopecks > 0
      ? [['Бонусами', formatRub(input.bonusKopecks)] as [string, string]]
      : []),
  ]
  const tickets = input.ticketNumbers.join(', ')
  const html = layout(
    subject,
    h1(input.completed ? 'Возврат выполнен' : 'Возврат обрабатывается') +
      p(escapeHtml(lead)) +
      p(`Заказ <b>${escapeHtml(input.orderNumber)}</b>, билеты: ${escapeHtml(tickets)}.`) +
      p(`Возвращённые билеты больше не действуют.`) +
      amountsRows(rows) +
      button(input.accountUrl, 'Открыть личный кабинет'),
  )
  const text = [
    subject,
    '',
    lead,
    '',
    `Заказ ${input.orderNumber}, билеты: ${tickets}.`,
    'Возвращённые билеты больше не действуют.',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    `Личный кабинет: ${input.accountUrl}`,
  ].join('\n')
  return { subject, text, html }
}

export type NeedsReviewEmailInput = {
  orderNumber: string
  /** Машинная причина (`LATE_PAYMENT_NO_STOCK`, `AMOUNT_MISMATCH`, …). */
  reason: string | null
  adminUrl: string
}

const REVIEW_REASONS: Record<string, string> = {
  LATE_PAYMENT_NO_STOCK:
    'Оплата пришла после окончания брони, а свободных мест уже нет. Нужен полный возврат или решение театра.',
  AMOUNT_MISMATCH: 'Сумма платежа не совпала с суммой заказа. Билеты не выпущены.',
  CURRENCY_MISMATCH: 'Валюта платежа не совпала с валютой заказа. Билеты не выпущены.',
}

/** Театру: заказ требует ручного разбора (PRD §5.3, TICKETS-07). Без ПД покупателя. */
export function needsReviewEmail(input: NeedsReviewEmailInput): Email {
  const subject = `Заказ ${input.orderNumber} требует проверки`
  const reason =
    (input.reason && REVIEW_REASONS[input.reason]) ??
    'Заказ переведён на ручную проверку. Подробности — в админке.'
  const html = layout(
    subject,
    h1(subject) +
      p(escapeHtml(reason)) +
      (input.reason ? p(`Код причины: <code>${escapeHtml(input.reason)}</code>`) : '') +
      button(input.adminUrl, 'Открыть админку'),
  )
  const text = [
    subject,
    '',
    reason,
    ...(input.reason ? [`Код причины: ${input.reason}`] : []),
    '',
    `Админка: ${input.adminUrl}`,
  ].join('\n')
  return { subject, text, html }
}
