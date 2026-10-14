import { z } from 'zod'

const contactSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Проверьте адрес электронной почты' })),
  consent: z.literal(true, { error: 'Нужно согласие на обработку персональных данных' }),
})

export type Contact = { email: string }
export type ContactErrors = Partial<Record<'email' | 'consent', string>>

/** Минимум ПД для покупки — только email (rules.md §4). */
export const parseContact = (
  input: unknown,
): { ok: true; contact: Contact } | { ok: false; errors: ContactErrors } => {
  const result = contactSchema.safeParse(input)
  if (result.success) return { ok: true, contact: { email: result.data.email } }
  const errors: ContactErrors = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0]
    if ((field === 'email' || field === 'consent') && !errors[field]) errors[field] = issue.message
  }
  return { ok: false, errors }
}
