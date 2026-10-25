import { normalizeReferralCode } from '@/modules/loyalty'

import type { AttachResult } from './service'

export type SignupReferralOutcome = 'attached' | 'skipped' | 'rejected' | 'failed'

/**
 * Приглашение при регистрации (T-062): код из `/register?ref=` привязывается только к
 * покупателю, созданному этим подтверждением почты. Уже существующий аккаунт (вошёл по ссылке
 * друга) не привязывается. Любая ошибка — не повод сорвать регистрацию: вход уже состоялся.
 */
export async function attachReferralOnSignup(
  attach: (referredCustomerId: string, code: string, now: Date) => Promise<AttachResult>,
  input: { created: boolean; customerId: string; ref: string | null | undefined; now: Date },
): Promise<SignupReferralOutcome> {
  const code = normalizeReferralCode(input.ref)
  if (!input.created || !code) return 'skipped'
  try {
    const result = await attach(input.customerId, code, input.now)
    return result.ok ? 'attached' : 'rejected'
  } catch {
    return 'failed'
  }
}
