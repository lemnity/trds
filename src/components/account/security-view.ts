import { CODE_LENGTH, PASSWORD_MIN } from '@/modules/auth'

/**
 * Тексты блока «Пароль и сеансы» в профиле (T-055) — отдельно от компонента, чтобы проверить
 * тестом, что каждый ответ API превращается в понятное сообщение у нужного поля.
 */

export type PasswordField = 'current' | 'code' | 'next'

export type PasswordFeedback =
  | { kind: 'field'; field: PasswordField; text: string }
  | { kind: 'notice'; text: string; relogin?: boolean }

export const newPasswordError = (value: string) =>
  value.length < PASSWORD_MIN
    ? `Не короче ${PASSWORD_MIN} символов`
    : value.length > 128
      ? 'Не длиннее 128 символов'
      : null

/** Ответ `POST /api/account/password` (кроме 200) → сообщение. */
export function passwordChangeFeedback(status: number, error?: string | null): PasswordFeedback {
  if (status === 400 && error === 'weak')
    return { kind: 'field', field: 'next', text: `Не короче ${PASSWORD_MIN} символов` }
  if (status === 400 && error === 'invalid_current')
    return { kind: 'field', field: 'current', text: 'Неверный текущий пароль' }
  if (status === 400 && error === 'invalid_code')
    return {
      kind: 'field',
      field: 'code',
      text: 'Неверный или устаревший код. Проверьте письмо или запросите новый.',
    }
  if (status === 400 && error === 'proof_required')
    return { kind: 'notice', text: 'Введите текущий пароль или код из письма.' }
  if (status === 401)
    return { kind: 'notice', text: 'Сессия закончилась — войдите снова.', relogin: true }
  if (status === 429)
    return { kind: 'notice', text: 'Слишком много попыток. Попробуйте через 15 минут.' }
  if (status === 0 || status === 503)
    return { kind: 'notice', text: 'Нет связи с сервером. Попробуйте ещё раз чуть позже.' }
  return { kind: 'notice', text: 'Что-то пошло не так. Попробуйте ещё раз.' }
}

/** Ответ `POST /api/account/password/code` (кроме 200) → сообщение. */
export function passwordCodeFeedback(
  status: number,
  data: { error?: string; retryAfter?: number } | null,
): string {
  if (data?.error === 'email_unavailable')
    return 'Отправка писем пока не настроена — смените пароль через текущий.'
  if (status === 429 && data?.error === 'cooldown')
    return `Код уже отправлен. Новый можно запросить через ${data.retryAfter ?? 60} с.`
  if (status === 429)
    return `Слишком много писем. Попробуйте через ${Math.ceil((data?.retryAfter ?? 3600) / 60)} мин.`
  if (status === 401) return 'Сессия закончилась — войдите снова.'
  if (status === 0 || status === 503) return 'Нет связи с сервером. Попробуйте ещё раз чуть позже.'
  return 'Не получилось отправить код. Попробуйте ещё раз.'
}

export const codeFieldError = (code: string) =>
  code.length === CODE_LENGTH ? null : `Введите ${CODE_LENGTH} цифр из письма`
