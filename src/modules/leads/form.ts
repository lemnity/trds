import { z } from 'zod'

/**
 * Заявка на корпоратив / частный спектакль (T-034, architecture.md `leads`). Здесь — разбор
 * полей формы, общий для браузера и сервера. Сохранение, журнал согласия и защита от дублей —
 * `@/modules/lead-requests` (`POST /api/leads`); канбан — T-065.
 */

export const LEAD_FORMATS = [
  { id: 'corporate', label: 'Корпоратив' },
  { id: 'presentation', label: 'Презентация или конференция' },
  { id: 'birthday', label: 'День рождения' },
  { id: 'private', label: 'Частное событие' },
  { id: 'other', label: 'Другое' },
] as const

export type LeadFormat = (typeof LEAD_FORMATS)[number]['id']

export type Lead = {
  name: string
  email?: string
  phone?: string
  date?: string
  guests?: number
  format: LeadFormat
  budget?: string
  comment?: string
}

type Field =
  'name' | 'email' | 'phone' | 'date' | 'guests' | 'format' | 'budget' | 'comment' | 'consent'
export type LeadErrors = Partial<Record<Field, string>>

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, { error: message })
    .transform((v) => v || undefined)

/** Телефон: 10 цифр после кода страны (+7, 7 или 8 в начале отбрасываются). */
const phone = z
  .string()
  .transform((raw) => raw.replace(/\D/g, ''))
  .transform((d) => (d.length === 11 && /^[78]/.test(d) ? d.slice(1) : d))
  .refine((d) => d === '' || /^\d{10}$/.test(d), { error: 'Номер телефона: 10 цифр после +7' })
  .transform((d) => (d ? `+7${d}` : undefined))

/** Сегодня по времени театра (Екатеринбург) в виде ГГГГ-ММ-ДД. */
const todayInTheatre = (now: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yekaterinburg' }).format(now)

const schema = (now: Date) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, { error: 'Укажите имя' })
      .max(100, { error: 'Слишком длинное имя' }),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .refine((v) => v === '' || z.email().safeParse(v).success, {
        error: 'Проверьте адрес электронной почты',
      })
      .transform((v) => v || undefined),
    phone,
    date: z
      .string()
      .trim()
      .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), { error: 'Проверьте дату' })
      .refine((v) => v === '' || v >= todayInTheatre(now), { error: 'Дата уже прошла' })
      .transform((v) => v || undefined),
    guests: z
      .string()
      .trim()
      .refine((v) => v === '' || (/^\d+$/.test(v) && +v >= 1 && +v <= 1000), {
        error: 'Число гостей — от 1 до 1000',
      })
      .transform((v) => (v ? Number(v) : undefined)),
    format: z.enum(LEAD_FORMATS.map((f) => f.id) as [LeadFormat, ...LeadFormat[]], {
      error: 'Выберите формат',
    }),
    budget: optionalText(100, 'Слишком длинно'),
    comment: optionalText(2000, 'Комментарий — до 2000 символов'),
    consent: z.literal(true, { error: 'Нужно согласие на обработку персональных данных' }),
  })

export const parseLead = (
  input: unknown,
  now: Date,
): { ok: true; value: Lead } | { ok: false; errors: LeadErrors } => {
  const r = schema(now).safeParse(input)
  const errors: LeadErrors = {}
  if (!r.success)
    for (const issue of r.error.issues) {
      const field = String(issue.path[0]) as Field
      if (!errors[field]) errors[field] = issue.message
    }
  // Нужен хотя бы один способ ответить. Проверяем по сырым полям — и при других ошибках тоже.
  const raw = (input ?? {}) as { email?: unknown; phone?: unknown }
  const blank = (v: unknown) => typeof v !== 'string' || v.trim() === ''
  if (blank(raw.email) && blank(raw.phone) && !errors.email)
    errors.email = 'Оставьте почту или телефон, чтобы мы ответили'
  if (!r.success || Object.keys(errors).length) return { ok: false, errors }
  // Согласие в заявку не кладём — его фиксирует журнал согласий на сервере.
  const value = Object.fromEntries(
    Object.entries(r.data).filter(([key, v]) => key !== 'consent' && v !== undefined),
  ) as Lead
  return { ok: true, value }
}

const formatLabel = (id: LeadFormat) => LEAD_FORMATS.find((f) => f.id === id)!.label

/** Текст письма театру: только заполненные поля, по строке на поле. */
export const leadMailBody = (lead: Lead) =>
  [
    `Имя: ${lead.name}`,
    lead.email && `Почта: ${lead.email}`,
    lead.phone && `Телефон: ${lead.phone}`,
    `Формат: ${formatLabel(lead.format)}`,
    lead.date && `Дата: ${lead.date.split('-').reverse().join('.')}`,
    lead.guests && `Гостей: ${lead.guests}`,
    lead.budget && `Бюджет: ${lead.budget}`,
    lead.comment && `Комментарий: ${lead.comment}`,
  ]
    .filter(Boolean)
    .join('\n')
