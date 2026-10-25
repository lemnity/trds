import type { EmailMessage } from './types'

/**
 * Письмо театру о новой заявке на корпоратив (T-034, T-065). Без контактов заявителя и его имени:
 * формат, дата, гости и ссылка на канбан — подробности сотрудник видит в админке под ролью.
 * Письмо может переслаться или лечь в общий ящик — персональные данные туда не кладём.
 */

type Email = Omit<EmailMessage, 'to' | 'idempotencyKey'>

export type LeadCreatedEmailInput = {
  /** Название формата для людей: «Корпоратив», «День рождения»… */
  formatLabel: string
  /** YYYY-MM-DD или null — дата не указана. */
  eventDate: string | null
  guests: number | null
  /** Тот же контакт уже оставлял заявку за сутки. */
  duplicate: boolean
  boardUrl: string
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? escapeHtml(url) : '#')

/** «25 декабря 2026» — дата события без времени, часовой пояс не важен. */
const formatDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
}

export function leadCreatedEmail(input: LeadCreatedEmailInput): Email {
  const rows: [string, string][] = [
    ['Формат', input.formatLabel],
    ['Дата', input.eventDate ? formatDate(input.eventDate) : 'не указана'],
    ['Гостей', input.guests ? String(input.guests) : 'не указано'],
  ]
  const subject = `Новая заявка: ${input.formatLabel}`
  const note = input.duplicate
    ? 'Похоже на повтор: с этого контакта уже была заявка за последние сутки.'
    : null
  const html =
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:24px 12px;background:#f3f2ef;color:#0f1426;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">` +
    `<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px 24px">` +
    `<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25">${escapeHtml(subject)}</h1>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:8px 0 16px">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 0;color:#5b6070">${escapeHtml(k)}</td><td style="padding:6px 0;text-align:right;font-weight:700">${escapeHtml(v)}</td></tr>`,
      )
      .join('') +
    `</table>` +
    (note ? `<p style="margin:0 0 12px">${escapeHtml(note)}</p>` : '') +
    `<p style="margin:0 0 12px">Контакты и комментарий — в карточке заявки.</p>` +
    `<p style="margin:16px 0"><a href="${safeUrl(input.boardUrl)}" style="display:inline-block;padding:12px 20px;background:#1f3a8a;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:700">Открыть канбан</a></p>` +
    `</div></body></html>`
  const text = [
    subject,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(note ? ['', note] : []),
    '',
    'Контакты и комментарий — в карточке заявки.',
    `Канбан: ${input.boardUrl}`,
  ].join('\n')
  return { subject, text, html }
}
