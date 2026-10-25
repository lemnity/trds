import {
  LOYALTY_RULES,
  bonusExpiresAt,
  certificateLast4,
  certificateSerial,
  parseCertificateCode,
  referralProgress,
} from '@/modules/loyalty'

import type { LoyaltyCertificate, LoyaltyHistoryEntry, LoyaltySummary } from './loyalty-view'

/**
 * ДЕМО бонусов для статического превью (GitHub Pages, сервера нет): набор операций в
 * localStorage этого браузера, чтобы можно было посмотреть кабинет и попробовать сертификат.
 * Это не настоящий баланс. Ключ и поле `balanceKopecks` верхнего уровня читает демо-оформление
 * заказа — менять согласованно.
 */
export const DEMO_LOYALTY_KEY = 'turdus:demo-loyalty'

/** Номинал любого демо-сертификата. */
export const DEMO_CERTIFICATE_KOPECKS = 100_000

export type DemoLoyaltyState = {
  version: 1
  balanceKopecks: number
  expiring: LoyaltySummary['expiring']
  history: LoyaltyHistoryEntry[]
  referral: { code: string; qualified: number }
  certificates: LoyaltyCertificate[]
  /** Канонические номера уже активированных сертификатов (повтор — «уже активирован»). */
  activated: string[]
}

const DAY_MS = 86_400_000
const iso = (d: Date) => d.toISOString()
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS)

/**
 * Начальный набор: две покупки (3% от оплаченного деньгами), оплата части заказа бонусами,
 * один приглашённый друг. Суммы согласованы между собой: 90 + 120 − 60 = 150 ₽,
 * и 30 ₽ от старого начисления сгорят через 25 дней.
 */
export const createDemoState = (now: Date): DemoLoyaltyState => {
  const old = daysAgo(now, LOYALTY_RULES.bonusLifetimeDays - 25)
  const recent = daysAgo(now, 40)
  const spent = daysAgo(now, 12)
  return {
    version: 1,
    balanceKopecks: 15_000,
    expiring: { amountKopecks: 3_000, earliest: iso(bonusExpiresAt(old)) },
    history: [
      { id: 'demo-3', kind: 'spend', amountKopecks: -6_000, at: iso(spent), expiresAt: null },
      {
        id: 'demo-2',
        kind: 'purchase',
        amountKopecks: 12_000,
        at: iso(recent),
        expiresAt: iso(bonusExpiresAt(recent)),
      },
      {
        id: 'demo-1',
        kind: 'purchase',
        amountKopecks: 9_000,
        at: iso(old),
        expiresAt: iso(bonusExpiresAt(old)),
      },
    ],
    referral: { code: 'DEMO7K3M', qualified: 1 },
    certificates: [],
    activated: [],
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Разбор сохранённого состояния; повреждённое или старое — `null` (создадим заново). */
export const parseDemoState = (raw: string | null): DemoLoyaltyState | null => {
  if (!raw) return null
  try {
    const data: unknown = JSON.parse(raw)
    if (
      !isRecord(data) ||
      data.version !== 1 ||
      !Number.isSafeInteger(data.balanceKopecks) ||
      !Array.isArray(data.history) ||
      !Array.isArray(data.certificates) ||
      !Array.isArray(data.activated) ||
      !isRecord(data.referral)
    )
      return null
    return data as DemoLoyaltyState
  } catch {
    return null
  }
}

/** Демо-состояние в форме ответа `/api/loyalty/summary`. `origin` — адрес сайта с basePath. */
export const demoSummary = (state: DemoLoyaltyState, origin: string): LoyaltySummary => ({
  balanceKopecks: state.balanceKopecks,
  expiring: state.expiring,
  history: state.history,
  referral: {
    code: state.referral.code,
    link: `${origin}/register?ref=${state.referral.code}`,
    qualified: state.referral.qualified,
    progress: referralProgress(state.referral.qualified),
  },
  certificates: state.certificates,
})

export type DemoActivation =
  | { ok: true; state: DemoLoyaltyState; amountKopecks: number; expiresAt: string }
  | { ok: false; error: 'invalid_format' | 'checksum' | 'not_available' }

/**
 * Демо-активация: принимается любой номер правильного формата, один раз — +1 000 ₽.
 * Как и на сервере, за сертификат не начисляются проценты — только номинал.
 */
export const activateDemoCertificate = (
  state: DemoLoyaltyState,
  input: string,
  now: Date,
): DemoActivation => {
  const parsed = parseCertificateCode(input)
  if (!parsed.ok)
    return { ok: false, error: parsed.error === 'FORMAT' ? 'invalid_format' : 'checksum' }
  if (state.activated.includes(parsed.canonical)) return { ok: false, error: 'not_available' }
  const at = iso(now)
  const expiresAt = iso(bonusExpiresAt(now))
  const amountKopecks = DEMO_CERTIFICATE_KOPECKS
  return {
    ok: true,
    amountKopecks,
    expiresAt,
    state: {
      ...state,
      balanceKopecks: state.balanceKopecks + amountKopecks,
      history: [
        { id: `demo-cert-${parsed.canonical}`, kind: 'certificate', amountKopecks, at, expiresAt },
        ...state.history,
      ],
      certificates: [
        {
          serial: certificateSerial(state.certificates.length + 1),
          last4: certificateLast4(parsed.canonical),
          amountKopecks,
          activatedAt: at,
          expiresAt,
        },
        ...state.certificates,
      ],
      activated: [...state.activated, parsed.canonical],
    },
  }
}
