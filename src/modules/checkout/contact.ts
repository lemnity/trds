import { z } from 'zod'

export const PAYMENT_METHODS = ['card', 'sbp', 'boxoffice'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/** Телефон: только цифры; 11 цифр с 7/8 в начале или 10 без кода. Пусто или «+7» — не указан. */
const phoneSchema = z
  .string()
  .transform((raw) => raw.replace(/\D/g, ''))
  .transform((digits) => (digits.length === 11 && /^[78]/.test(digits) ? digits.slice(1) : digits))
  .refine((d) => d === '' || d === '7' || /^\d{10}$/.test(d), {
    error: 'Номер телефона: 10 цифр после +7',
  })
  .transform((d) => (d === '' || d === '7' ? undefined : `+7${d}`))

const contactSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Проверьте адрес электронной почты' })),
  name: z
    .string()
    .trim()
    .max(100, { error: 'Слишком длинное имя' })
    .optional()
    .transform((v) => v || undefined),
  phone: phoneSchema.optional(),
  payment: z.enum(PAYMENT_METHODS, { error: 'Выберите способ оплаты' }),
  consent: z.literal(true, { error: 'Нужно согласие на обработку персональных данных' }),
  rulesAccepted: z.literal(true, { error: 'Нужно согласиться с правилами продажи и возврата' }),
})

export type Contact = { email: string; payment: PaymentMethod; name?: string; phone?: string }
type Field = 'email' | 'name' | 'phone' | 'payment' | 'consent' | 'rulesAccepted'
export type ContactErrors = Partial<Record<Field, string>>
const FIELDS = new Set<string>(['email', 'name', 'phone', 'payment', 'consent', 'rulesAccepted'])

/**
 * Обязателен только email (rules.md §4). Имя и телефон — по желанию покупателя (поля из
 * референса заказчика); нужен ли телефон схеме чека, решается в T-002 — до этого он не
 * обязателен и никуда не отправляется.
 */
export const parseContact = (
  input: unknown,
): { ok: true; contact: Contact } | { ok: false; errors: ContactErrors } => {
  const result = contactSchema.safeParse(input)
  if (result.success) {
    const { email, payment, name, phone } = result.data
    return {
      ok: true,
      contact: { email, payment, ...(name && { name }), ...(phone && { phone }) },
    }
  }
  const errors: ContactErrors = {}
  for (const issue of result.error.issues) {
    const field = String(issue.path[0])
    if (FIELDS.has(field) && !errors[field as Field]) errors[field as Field] = issue.message
  }
  return { ok: false, errors }
}

/**
 * Маска поля телефона: «+7 912 345-67-89» по мере ввода. Код страны в начале (+7, 7 или 8)
 * отбрасывается, лишние цифры — тоже.
 */
export const formatPhoneInput = (value: string) => {
  let digits = value.replace(/\D/g, '')
  // «+7…» или номер, начатый с 7/8 (как обычно пишут «8 912…»), — это код страны.
  const hasCountryCode = value.trim().startsWith('+7') || /^[78]/.test(digits)
  if (hasCountryCode) digits = digits.slice(1)
  digits = digits.slice(0, 10)
  if (!digits) return hasCountryCode && !value.trim().startsWith('+') ? '+7 ' : ''
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 8), digits.slice(8, 10)]
  let out = `+7 ${parts[0]}`
  if (parts[1]) out += ` ${parts[1]}`
  if (parts[2]) out += `-${parts[2]}`
  if (parts[3]) out += `-${parts[3]}`
  return out
}
