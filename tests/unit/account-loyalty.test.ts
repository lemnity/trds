import { randomInt } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  DEMO_CERTIFICATE_KOPECKS,
  activateDemoCertificate,
  createDemoState,
  demoSummary,
  parseDemoState,
} from '../../src/components/account/loyalty-demo'
import {
  CERTIFICATE_ERRORS,
  activationErrorText,
  activationSuccessText,
  certificateInputError,
  formatCertificateInput,
  formatDate,
  formatDayMonth,
  formatSignedRub,
  historyLabel,
  lifetimeText,
  referralCaption,
  rulesLine,
} from '../../src/components/account/loyalty-view'
import {
  LOYALTY_RULES,
  generateCertificateCode,
  referralRemainingText,
} from '../../src/modules/loyalty'

// Intl ставит неразрывные пробелы — сравниваем, нормализуя их.
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')
const now = new Date('2026-10-25T09:00:00Z')
const validCode = () => generateCertificateCode((max) => randomInt(max))

describe('account loyalty view helpers', () => {
  it('labels every history kind and falls back for unknown ones', () => {
    expect(historyLabel('purchase')).toBe('Покупка')
    expect(historyLabel('referral')).toBe('Приведи друзей')
    expect(historyLabel('certificate')).toBe('Сертификат')
    expect(historyLabel('spend')).toBe('Оплата заказа')
    expect(historyLabel('expire')).toBe('Сгорели')
    expect(historyLabel('manual')).toBe('Корректировка')
    expect(historyLabel('other')).toBe('Операция')
  })

  it('formats signed amounts with a real minus', () => {
    expect(plain(formatSignedRub(12_000))).toBe('+120 ₽')
    expect(plain(formatSignedRub(-6_000))).toBe('−60 ₽')
    expect(plain(formatSignedRub(0))).toBe('0 ₽')
  })

  it('formats dates in the theatre time zone', () => {
    expect(formatDate('2027-10-25T09:00:00Z')).toBe('25.10.2027')
    // 20:00 UTC — уже следующий день в Екатеринбурге (UTC+5).
    expect(formatDayMonth('2026-11-19T20:00:00Z')).toBe('20.11')
    expect(formatDate('not a date')).toBe('')
  })

  it('states the approved rules with real numbers', () => {
    expect(rulesLine()).toBe('3% за покупки · до 30% стоимости билета · срок 1 год')
    expect(lifetimeText(730)).toBe('2 года')
    expect(lifetimeText(90)).toBe('90 дней')
  })

  it('captions the referral progress', () => {
    const caption = (inRound: number, rewards: number) =>
      plain(referralCaption({ inRound, remaining: 3 - inRound, rewards }, referralRemainingText))
    expect(caption(0, 0)).toBe('Пригласите трёх друзей — получите 1 000 ₽ бонусами')
    expect(caption(1, 0)).toBe('Осталось ещё 2 друга')
    expect(caption(2, 1)).toBe('Остался ещё 1 друг')
    expect(caption(0, 2)).toBe('Пригласите ещё трёх друзей — получите ещё 1 000 ₽ бонусами')
  })
})

describe('certificate input', () => {
  it('uppercases, drops junk and groups by four without a trailing dash', () => {
    expect(formatCertificateInput('trds')).toBe('TRDS')
    expect(formatCertificateInput('trds7')).toBe('TRDS-7')
    expect(formatCertificateInput('TRDS-7K3M-')).toBe('TRDS-7K3M')
    expect(formatCertificateInput(' trds 7k3m_ab2c#dd9x zz')).toBe('TRDS-7K3M-AB2C-DD9X')
    // Русская раскладка: похожие буквы — латиницей.
    expect(formatCertificateInput('ТRDS-СКМР')).toBe('TRDS-CKMP')
  })

  it('validates instantly only what is certainly wrong', () => {
    const code = validCode()
    expect(certificateInputError(code)).toBeNull()
    expect(certificateInputError(code.slice(5))).toBeNull() // без префикса тоже можно
    expect(certificateInputError('TRDS-7K3M')).toBeNull() // ещё набирается
    expect(certificateInputError('TRDS-7K3M', true)).toBe(CERTIFICATE_ERRORS.incomplete)
    expect(certificateInputError('', true)).toBe(CERTIFICATE_ERRORS.empty)
    expect(certificateInputError('TRDS-7K0M')).toBe(CERTIFICATE_ERRORS.symbols)
    // Одна заменённая буква — опечатка ловится контрольным символом.
    const last = code.at(-1) === '2' ? '3' : '2'
    expect(certificateInputError(code.slice(0, -1) + last)).toBe(CERTIFICATE_ERRORS.checksum)
  })

  it('maps server answers to messages', () => {
    expect(activationErrorText(422, 'not_available')).toBe(
      'Сертификат не найден или уже активирован',
    )
    expect(activationErrorText(429, 'rate_limited')).toBe(
      'Слишком много попыток, попробуйте через 15 минут',
    )
    expect(activationErrorText(400, 'checksum')).toBe(CERTIFICATE_ERRORS.checksum)
    expect(activationErrorText(503, 'unavailable')).toBe(CERTIFICATE_ERRORS.unavailable)
    expect(activationErrorText(0)).toBe(CERTIFICATE_ERRORS.unavailable)
    expect(plain(activationSuccessText(100_000, '2027-10-25T09:00:00Z'))).toBe(
      'На баланс зачислено 1 000 ₽ · действуют до 25.10.2027',
    )
  })
})

describe('demo loyalty store', () => {
  it('starts with a consistent dataset', () => {
    const state = createDemoState(now)
    const sum = state.history.reduce((s, h) => s + h.amountKopecks, 0)
    expect(state.balanceKopecks).toBe(sum)
    expect(state.expiring?.amountKopecks).toBeLessThanOrEqual(state.balanceKopecks)
    const summary = demoSummary(state, 'https://example.test/trds')
    expect(summary.referral.link).toBe('https://example.test/trds/register?ref=DEMO7K3M')
    expect(summary.referral.progress).toEqual({
      inRound: 1,
      remaining: 2,
      rewards: 0,
      groupSize: 3,
    })
  })

  it('round-trips through JSON with balanceKopecks at the top level', () => {
    const state = createDemoState(now)
    const raw = JSON.stringify(state)
    expect((JSON.parse(raw) as { balanceKopecks: number }).balanceKopecks).toBe(15_000)
    expect(parseDemoState(raw)).toEqual(state)
    expect(parseDemoState('{oops')).toBeNull()
    expect(parseDemoState(JSON.stringify({ version: 2 }))).toBeNull()
    expect(parseDemoState(null)).toBeNull()
  })

  it('credits a valid code once and rejects bad ones', () => {
    const start = createDemoState(now)
    const code = validCode()
    const first = activateDemoCertificate(start, code.toLowerCase(), now)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.amountKopecks).toBe(DEMO_CERTIFICATE_KOPECKS)
    expect(first.state.balanceKopecks).toBe(start.balanceKopecks + DEMO_CERTIFICATE_KOPECKS)
    expect(first.state.history[0]?.kind).toBe('certificate')
    expect(first.state.certificates[0]).toMatchObject({
      serial: 'С-000001',
      last4: code.slice(-4),
      amountKopecks: DEMO_CERTIFICATE_KOPECKS,
    })
    expect(new Date(first.expiresAt).getTime() - now.getTime()).toBe(
      LOYALTY_RULES.bonusLifetimeDays * 86_400_000,
    )
    expect(activateDemoCertificate(first.state, code, now)).toEqual({
      ok: false,
      error: 'not_available',
    })
    expect(activateDemoCertificate(start, 'TRDS-7K3M', now)).toEqual({
      ok: false,
      error: 'invalid_format',
    })
    expect(start.certificates).toHaveLength(0) // исходное состояние не меняется
  })
})
