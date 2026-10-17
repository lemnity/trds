import { z } from 'zod'

/**
 * Формы входа и регистрации (PRD 5.5, T-050). Основной способ — одноразовый код из письма;
 * вход по паролю — запасной (решение заказчика 18.10.2026). Здесь — только разбор полей формы;
 * выдача и проверка кода (хеш, TTL, лимиты, без раскрытия наличия email) — серверная часть T-050.
 */

export const CODE_LENGTH = 6

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Проверьте адрес электронной почты' }))

const loginSchema = z.object({ email })

// Пароль не трогаем (пробелы — часть пароля); правила сложности — при его задании, не при входе.
const passwordLoginSchema = z.object({
  email,
  password: z.string().min(1, { error: 'Введите пароль' }),
})

/** Правило нового пароля (при регистрации). Пробелы — часть пароля, не тримим. */
export const PASSWORD_MIN = 8

const newPassword = z
  .string()
  .min(PASSWORD_MIN, { error: `Пароль — не короче ${PASSWORD_MIN} символов` })
  .max(128, { error: 'Слишком длинный пароль' })

const registrationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'Укажите имя' })
    .max(100, { error: 'Слишком длинное имя' }),
  email,
  password: newPassword,
  consent: z.literal(true, { error: 'Нужно согласие на обработку персональных данных' }),
})

type Result<T, F extends string> =
  { ok: true; value: T } | { ok: false; errors: Partial<Record<F, string>> }

const collect = <F extends string>(issues: z.core.$ZodIssue[]) => {
  const errors: Partial<Record<F, string>> = {}
  for (const issue of issues) {
    const field = String(issue.path[0]) as F
    if (!errors[field]) errors[field] = issue.message
  }
  return errors
}

export type LoginErrors = Partial<Record<'email', string>>
export type RegistrationErrors = Partial<Record<'name' | 'email' | 'password' | 'consent', string>>

export const parseLogin = (input: unknown): Result<{ email: string }, 'email'> => {
  const r = loginSchema.safeParse(input)
  return r.success ? { ok: true, value: r.data } : { ok: false, errors: collect(r.error.issues) }
}

/**
 * Вход по паролю — запасной способ (решение заказчика 18.10.2026, расширение PRD 5.5).
 * Серверу нужны: хеш argon2id/bcrypt, лимит попыток, одинаковый ответ для несуществующего email,
 * восстановление — через вход по коду.
 */
export const parsePasswordLogin = (
  input: unknown,
): Result<{ email: string; password: string }, 'email' | 'password'> => {
  const r = passwordLoginSchema.safeParse(input)
  return r.success ? { ok: true, value: r.data } : { ok: false, errors: collect(r.error.issues) }
}

export const parseRegistration = (
  input: unknown,
): Result<
  { name: string; email: string; password: string },
  'name' | 'email' | 'password' | 'consent'
> => {
  const r = registrationSchema.safeParse(input)
  return r.success
    ? { ok: true, value: { name: r.data.name, email: r.data.email, password: r.data.password } }
    : { ok: false, errors: collect(r.error.issues) }
}

/** Ввод кода: только цифры, не длиннее кода (вставка «12 34-56» тоже работает). */
export const normalizeCode = (input: string) => input.replace(/\D/g, '').slice(0, CODE_LENGTH)

export const isCodeComplete = (code: string) => code.length === CODE_LENGTH

/** Почта для подписи «код отправлен на …»: середина имени скрыта. */
export const maskEmail = (value: string) => {
  const [local = '', domain = ''] = value.split('@')
  if (local.length <= 2) return `${local[0] ?? ''}•@${domain}`
  return `${local[0]}${'•'.repeat(local.length - 2)}${local.at(-1)}@${domain}`
}
