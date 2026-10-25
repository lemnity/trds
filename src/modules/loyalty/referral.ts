/**
 * Код приглашения из ссылки `/register?ref=КОД` (T-062): латиница и цифры, до 16 символов,
 * регистр не важен. Всё остальное — как будто кода нет (регистрация идёт обычным путём).
 */
export const normalizeReferralCode = (raw: string | null | undefined): string | null => {
  const code = raw?.trim().toUpperCase() ?? ''
  return /^[A-Z0-9]{1,16}$/.test(code) ? code : null
}
