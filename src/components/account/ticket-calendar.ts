import type { TicketView } from '@/modules/tickets'

/**
 * «Добавить в календарь» (T-051): файл iCalendar (RFC 5545) с одним событием — показом. Время —
 * в UTC (`…Z`): календарь сам покажет его в поясе устройства. Без ПД: спектакль, площадка, номер
 * билета и ссылка на кабинет. Строки длиннее 75 байт переносятся, спецсимволы экранируются.
 */

const utc = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')

/** Экранирование TEXT (RFC 5545 §3.3.11). */
export const icsEscape = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

const encoder = new TextEncoder()

/** Перенос строки по 75 октетов UTF-8, не разрывая символ (RFC 5545 §3.1). */
export const icsFold = (line: string) => {
  const parts: string[] = []
  let current = ''
  let bytes = 0
  for (const ch of line) {
    const size = encoder.encode(ch).length
    // Продолжение начинается с пробела — он тоже считается в лимите.
    const limit = parts.length ? 74 : 75
    if (bytes + size > limit) {
      parts.push(current)
      current = ''
      bytes = 0
    }
    current += ch
    bytes += size
  }
  parts.push(current)
  return parts.join('\r\n ')
}

export function ticketIcs(
  t: Pick<TicketView, 'number' | 'show' | 'startsAt' | 'endsAt' | 'venue' | 'category' | 'seat'>,
  { now, siteUrl }: { now: Date; siteUrl: string },
): string | null {
  if (!t.startsAt || !t.endsAt) return null
  const title = t.show?.title ?? 'Спектакль театра TURDUS'
  const location = t.venue ? `${t.venue.title}, ${t.venue.address}` : null
  const place = t.seat ? `${t.category}, ${t.seat}` : t.category
  const account = `${siteUrl.replace(/\/$/, '')}/account#tickets`
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TURDUS//Tickets//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${t.number}@teatrturdus.ru`,
    `DTSTAMP:${utc(now.toISOString())}`,
    `DTSTART:${utc(t.startsAt)}`,
    `DTEND:${utc(t.endsAt)}`,
    `SUMMARY:${icsEscape(title)}`,
    ...(location ? [`LOCATION:${icsEscape(location)}`] : []),
    `DESCRIPTION:${icsEscape(`Билет ${t.number}. ${place}. QR-код — в личном кабинете: ${account}`)}`,
    `URL:${account}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT3H',
    `DESCRIPTION:${icsEscape(title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `${lines.map(icsFold).join('\r\n')}\r\n`
}

/** Скачать файл .ics в браузере. */
export function downloadIcs(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
