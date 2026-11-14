import { formatRub } from '@/lib/money'
import { contacts } from '@/modules/content'

import { LOGO_PNG_BASE64 } from './logo'
import type { EmailAttachment, EmailMessage } from './types'

/**
 * Шаблоны писем (T-047): билеты после оплаты, уведомление о возврате, ручная проверка заказа для
 * театра. Каждое письмо — HTML и текстовая версия (почтовые клиенты без HTML, доступность).
 * Все подставляемые значения экранируются. В письме зрителя — только его заказ: QR (токен без ПД),
 * номер билета, спектакль, площадка. Письмо театру — без данных покупателя: номер заказа и причина,
 * подробности — в админке под ролью.
 *
 * Оформление — по токенам сайта (src/styles/tokens.css): тёплый фон, белая поверхность, прямые
 * углы, тёмный блок как у hero, тёмно-синий акцент, Onest (где почта не грузит шрифты — Arial).
 * Почтовые клиенты не знают CSS-переменных, поэтому значения повторены здесь.
 */

type Email = Omit<EmailMessage, 'to' | 'idempotencyKey'>

const BRAND = 'Модный театр TURDUS'

const C = {
  background: '#f3f2ef',
  surface: '#ffffff',
  ink: '#15171c',
  muted: '#5d626b',
  hairline: '#e3e1dc',
  brand: '#1f3a8a',
  night: '#0f1426',
  nightMuted: '#b9bfcf',
}
const FONT = `'Onest',Arial,Helvetica,sans-serif`

const LOGO: EmailAttachment = {
  filename: 'turdus.png',
  content: Buffer.from(LOGO_PNG_BASE64, 'base64'),
  contentType: 'image/png',
  cid: 'logo@turdus',
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Ссылка только http(s): значение пришло из конфигурации, но проверяем на границе. */
const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? escapeHtml(url) : '#')

/** Ссылка в тексте: http(s), а для контактов театра — mailto:/tel:. Остальное (javascript: и т.п.) — «#». */
const link = (href: string, label: string, color: string = C.ink) =>
  `<a href="${/^mailto:|^tel:/i.test(href) ? escapeHtml(href) : safeUrl(href)}" style="color:${color};text-decoration:underline">${escapeHtml(label)}</a>`

/** Подвал как на сайте: как связаться с театром. Контакты — из `@/modules/content`. */
const footer = () =>
  `<p style="margin:0 0 6px;font-weight:700;color:${C.ink}">Вопросы по билетам</p>` +
  `<p style="margin:0 0 6px">${link(contacts.phone.href, contacts.phone.display)} · ${link(`mailto:${contacts.email}`, contacts.email)}</p>` +
  `<p style="margin:0 0 12px">${escapeHtml(contacts.office.hours)}</p>` +
  `<p style="margin:0">${contacts.social.map((s) => link(s.href, s.name, C.muted)).join(' · ')}</p>`

/**
 * Каркас письма: логотип и содержимое на белой поверхности поверх тёплого фона, подвал с
 * контактами. `preheader` — строка превью в списке писем (в теле не видна).
 */
const layout = (title: string, preheader: string, body: string) =>
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
  `<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;700&display=swap" rel="stylesheet">` +
  `<title>${escapeHtml(title)}</title>` +
  // Телефон: поля уже, QR билета уходит под факты (iOS Mail, Gmail-приложение понимают @media).
  `<style>@media (max-width:480px){.px{padding-left:20px!important;padding-right:20px!important}` +
  `.cell{display:block!important;width:auto!important}` +
  `.stack{display:block!important;width:auto!important;padding:0 20px 20px!important;text-align:left!important}}</style></head>` +
  `<body style="margin:0;padding:0;background:${C.background};color:${C.ink};font-family:${FONT};font-size:16px;line-height:1.55">` +
  `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>` +
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.background}"><tr><td align="center" style="padding:24px 12px">` +
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">` +
  `<tr><td class="px" style="background:${C.surface};padding:24px 28px;border-bottom:1px solid ${C.hairline}">` +
  `<img src="cid:${LOGO.cid}" width="123" height="44" alt="${BRAND}" style="display:block;width:123px;height:44px;border:0">` +
  `</td></tr>` +
  `<tr><td class="px" style="background:${C.surface};padding:28px">${body}</td></tr>` +
  `<tr><td class="px" style="padding:24px 28px;font-size:13px;line-height:1.5;color:${C.muted}">${footer()}</td></tr>` +
  `</table></td></tr></table></body></html>`

const h1 = (text: string) =>
  `<h1 style="margin:0 0 12px;font-size:30px;line-height:1.1;font-weight:700;letter-spacing:-0.01em">${escapeHtml(text)}</h1>`
const p = (html: string) => `<p style="margin:0 0 12px">${html}</p>`
/** Подпись раздела, как «01 Ближайшие даты» на странице спектакля. */
const section = (index: string, title: string) =>
  `<p style="margin:28px 0 12px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.muted}">` +
  `<span style="color:${C.brand}">${index}</span>&nbsp;&nbsp;${escapeHtml(title)}</p>`
const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px"><tr><td style="background:${C.brand}">` +
  `<a href="${safeUrl(href)}" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-weight:700">${escapeHtml(label)}</a>` +
  `</td></tr></table>`
const note = (html: string) =>
  `<p style="margin:16px 0 0;font-size:14px;color:${C.muted}">${html}</p>`

const amountsRows = (rows: [string, string][]) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid ${C.ink}">` +
  rows
    .map(([label, value], i) => {
      const total = i === rows.length - 1
      return (
        `<tr><td style="padding:10px 0;border-bottom:1px solid ${C.hairline};color:${total ? C.ink : C.muted}${total ? ';font-weight:700' : ''}">${escapeHtml(label)}</td>` +
        `<td style="padding:10px 0;border-bottom:1px solid ${C.hairline};text-align:right;font-weight:700${total ? ';font-size:18px' : ''}">${escapeHtml(value)}</td></tr>`
      )
    })
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
  const qrAttachments: EmailAttachment[] = input.tickets.map((t, i) => ({
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

  const fact = (label: string, value: string) =>
    `<tr><td style="padding:0 12px 8px 0;vertical-align:top;font-size:13px;color:${C.muted};white-space:nowrap">${escapeHtml(label)}</td>` +
    `<td style="padding:0 0 8px;vertical-align:top;font-size:15px">${value}</td></tr>`

  // Билет: тёмная плашка с названием (как hero спектакля) и белая часть с фактами и QR.
  const ticketHtml = input.tickets
    .map((t, i) => {
      const facts = [
        t.when && fact('Когда', `<b>${escapeHtml(t.when)}</b>`),
        t.venue && fact('Где', `${escapeHtml(t.venue.title)}<br>${escapeHtml(t.venue.address)}`),
        fact('Место', escapeHtml(t.seat ? `${t.category}, ${t.seat}` : t.category)),
      ].filter(Boolean)
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;border:1px solid ${C.hairline}">` +
        `<tr><td colspan="2" style="background:${C.night};padding:16px 20px">` +
        `<p style="margin:0 0 4px;font-size:13px;letter-spacing:.04em;color:${C.nightMuted}">Билет ${escapeHtml(t.number)}</p>` +
        `<p style="margin:0;font-size:22px;line-height:1.2;font-weight:700;color:#ffffff">${escapeHtml(t.showTitle ?? 'Спектакль театра TURDUS')}</p>` +
        `</td></tr>` +
        `<tr><td class="cell" style="padding:20px;vertical-align:top">` +
        `<table role="presentation" cellpadding="0" cellspacing="0">${facts.join('')}</table>` +
        `<p style="margin:8px 0 0;font-size:14px">${link(t.qrLink, 'Открыть QR-код', C.brand)}</p>` +
        `</td><td class="stack" style="padding:20px 20px 20px 0;width:160px;vertical-align:top" align="right">` +
        `<img src="cid:${qrAttachments[i]!.cid}" width="160" height="160" alt="QR-код билета ${escapeHtml(t.number)}" style="display:block;width:160px;height:160px;border:0">` +
        `</td></tr></table>`
      )
    })
    .join('')

  const title = count === 1 ? 'Ваш билет' : 'Ваши билеты'
  const html = layout(
    subject,
    `Заказ ${input.orderNumber} оплачен. Покажите QR-код на входе.`,
    h1(title) +
      p(
        `Заказ <b>${escapeHtml(input.orderNumber)}</b> оплачен. Покажите QR-код на входе — с экрана телефона или распечатанным.`,
      ) +
      section('01', count === 1 ? 'Билет' : 'Билеты') +
      ticketHtml +
      section('02', 'Оплата') +
      amountsRows(amountRows) +
      button(input.accountUrl, 'Билеты в личном кабинете') +
      note(
        'Не пересылайте письмо: QR-код — это ваш билет. Если письмо пришло вам по ошибке, просто удалите его.',
      ),
  )

  const text = [
    `${title} — ${BRAND}`,
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
    '',
    `Вопросы по билетам: ${contacts.phone.display}, ${contacts.email}`,
  ].join('\n')

  return { subject, text, html, attachments: [LOGO, ...qrAttachments] }
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
    ...(input.bonusKopecks > 0
      ? [['Бонусами', formatRub(input.bonusKopecks)] as [string, string]]
      : []),
    ['Деньгами', formatRub(input.cashKopecks)],
  ]
  const tickets = input.ticketNumbers.join(', ')
  const html = layout(
    subject,
    lead,
    h1(input.completed ? 'Возврат выполнен' : 'Возврат обрабатывается') +
      p(escapeHtml(lead)) +
      section('01', 'Заказ') +
      `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid ${C.hairline}"><tr><td style="padding:16px 20px">` +
      `<p style="margin:0 0 4px;font-size:13px;color:${C.muted}">Заказ ${escapeHtml(input.orderNumber)}</p>` +
      `<p style="margin:0 0 8px;font-weight:700">Билеты: ${escapeHtml(tickets)}</p>` +
      `<p style="margin:0;font-size:14px;color:${C.muted}">Возвращённые билеты больше не действуют.</p>` +
      `</td></tr></table>` +
      section('02', 'Сумма возврата') +
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
    '',
    `Вопросы по билетам: ${contacts.phone.display}, ${contacts.email}`,
  ].join('\n')
  return { subject, text, html, attachments: [LOGO] }
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
    reason,
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
  return { subject, text, html, attachments: [LOGO] }
}
