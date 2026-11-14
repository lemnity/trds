import { createHash, timingSafeEqual } from 'node:crypto'

import { base32Decode, matchTotp } from './totp'

/**
 * Супер-админ CMS: почта и секрет приложения-аутентификатора задаются в .env на сервере.
 *
 *   SUPERADMIN_EMAIL=owner@example.ru
 *   SUPERADMIN_TOTP_SECRET=<base32, добавляется в приложение-аутентификатор>
 *   SUPERADMIN_CODE=<6–12 цифр>  — единый постоянный код; если задан, вместо кода из приложения
 *   SUPERADMIN_PASSWORD=<не короче 12 символов> — вход «почта + пароль» (/api/cms/auth/password)
 *
 * Вход: почта → сразу код из приложения (без письма и без отдельного экрана /admin/mfa). Код
 * из приложения и есть второй фактор: сессия выдаётся уже подтверждённой. Сотрудник с этой
 * почтой создаётся сам при первом входе и всегда считается системным администратором.
 * Пустые переменные — режим выключен, вход как у всех.
 */

export type SuperAdminConfig = {
  email: string
  /** Секрет приложения-аутентификатора (base32). */
  secret?: string
  /** Постоянный код вместо кода из приложения. */
  code?: string
  /** Пароль для входа «почта + пароль». */
  password?: string
}

export const SUPERADMIN_PASSWORD_MIN = 12

/** Постоянный код: только цифры, 6–12 знаков (решение заказчика; от подбора — лимит неудач). */
export const SUPERADMIN_CODE_RE = /^\d{6,12}$/

/** Не меньше 128 бит: короче — слишком легко подобрать. */
const MIN_SECRET_BYTES = 16

export const normalizeTotpSecret = (raw: string) => raw.replace(/[\s-]/g, '').toUpperCase()

export function parseSuperAdminConfig(
  env: Record<string, string | undefined>,
): SuperAdminConfig | null {
  const email = (env.SUPERADMIN_EMAIL ?? '').trim().toLowerCase()
  if (!email) return null
  const config: SuperAdminConfig = { email }

  const password = env.SUPERADMIN_PASSWORD ?? ''
  if (password.length >= SUPERADMIN_PASSWORD_MIN) config.password = password
  else if (password)
    console.warn('SUPERADMIN_PASSWORD: нужно не меньше 12 символов — вход по паролю не включён')

  const code = (env.SUPERADMIN_CODE ?? '').trim()
  if (code && SUPERADMIN_CODE_RE.test(code)) config.code = code
  else if (code)
    console.warn('SUPERADMIN_CODE: нужны только цифры, 6–12 знаков — постоянный код не включён')

  const secret = normalizeTotpSecret(env.SUPERADMIN_TOTP_SECRET ?? '')
  if (secret && !config.code) {
    try {
      if (base32Decode(secret).length < MIN_SECRET_BYTES) throw new Error('short')
      config.secret = secret
    } catch {
      console.warn('SUPERADMIN_TOTP_SECRET: нужен base32 не короче 26 символов — не включён')
    }
  }
  return config.password || config.code || config.secret ? config : null
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
    if (config.code) return timingSafeEqual(digest(config.code), digest(code))
    if (!config.secret) return false
    const step = matchTotp(config.secret, code, now)
    if (step === null || step <= lastStep) return false
    lastStep = step
    return true
  }
}

/** Пароль супер-админа: сравнение за постоянное время; без настроенного пароля — всегда false. */
export const checkSuperAdminPassword = (config: SuperAdminConfig, password: string) =>
  !!config.password && timingSafeEqual(digest(config.password), digest(password))
