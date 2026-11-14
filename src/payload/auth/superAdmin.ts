import { createHash, timingSafeEqual } from 'node:crypto'

import { base32Decode, matchTotp } from './totp'

/**
 * Супер-админ CMS: почта и секрет приложения-аутентификатора задаются в .env на сервере.
 *
 *   SUPERADMIN_EMAIL=owner@example.ru
 *   SUPERADMIN_TOTP_SECRET=<base32, добавляется в приложение-аутентификатор>
 *   SUPERADMIN_CODE=<8–12 цифр>  — единый постоянный код; если задан, вместо кода из приложения
 *
 * Вход: почта → сразу код из приложения (без письма и без отдельного экрана /admin/mfa). Код
 * из приложения и есть второй фактор: сессия выдаётся уже подтверждённой. Сотрудник с этой
 * почтой создаётся сам при первом входе и всегда считается системным администратором.
 * Пустые переменные — режим выключен, вход как у всех.
 */

export type SuperAdminConfig =
  | { email: string; secret: string; code?: undefined }
  | { email: string; code: string; secret?: undefined }

/** Постоянный код: только цифры, 8–12 знаков (6 цифр подобрать слишком легко). */
export const SUPERADMIN_CODE_RE = /^\d{8,12}$/

/** Не меньше 128 бит: короче — слишком легко подобрать. */
const MIN_SECRET_BYTES = 16

export const normalizeTotpSecret = (raw: string) => raw.replace(/[\s-]/g, '').toUpperCase()

export function parseSuperAdminConfig(
  env: Record<string, string | undefined>,
): SuperAdminConfig | null {
  const email = (env.SUPERADMIN_EMAIL ?? '').trim().toLowerCase()
  if (!email) return null
  const code = (env.SUPERADMIN_CODE ?? '').trim()
  if (code) {
    if (SUPERADMIN_CODE_RE.test(code)) return { email, code }
    console.warn('SUPERADMIN_CODE: нужны только цифры, 8–12 знаков — постоянный код не включён')
  }
  const secret = normalizeTotpSecret(env.SUPERADMIN_TOTP_SECRET ?? '')
  if (!secret) return null
  try {
    if (base32Decode(secret).length < MIN_SECRET_BYTES) throw new Error('short')
  } catch {
    console.warn(
      'SUPERADMIN_TOTP_SECRET: нужен base32 не короче 26 символов — вход супер-админа выключен',
    )
    return null
  }
  return { email, secret }
}

export const superAdminFromEnv = () => parseSuperAdminConfig(process.env)

export const superAdminEmailFromEnv = () => superAdminFromEnv()?.email ?? null

const digest = (v: string) => createHash('sha256').update(v).digest()

/**
 * Проверка кода. Постоянный код — сравнение за постоянное время. Код из приложения — с защитой
 * от повтора: тот же шаг TOTP второй раз не принимается (последний шаг — в памяти процесса;
 * приложение работает одним процессом).
 */
export function createSuperAdminVerifier() {
  let lastStep = -1
  return (config: SuperAdminConfig, code: string, now = new Date()) => {
    if (config.code !== undefined) return timingSafeEqual(digest(config.code), digest(code))
    const step = matchTotp(config.secret, code, now)
    if (step === null || step <= lastStep) return false
    lastStep = step
    return true
  }
}
