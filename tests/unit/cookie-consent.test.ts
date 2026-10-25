import { describe, expect, it } from 'vitest'

import { createMetrikaLoader, METRIKA_SRC } from '../../src/components/site/metrika'
import {
  COOKIE_CONSENT_NAME,
  COOKIE_CONSENT_VERSION,
  cookieConsentHeader,
  mayLoadAnalytics,
  parseCookieConsent,
  parseMetrikaId,
  readCookie,
  serializeCookieConsent,
} from '../../src/modules/consent'

const at = new Date('2026-10-25T10:00:00Z')
const accepted = { version: COOKIE_CONSENT_VERSION, analytics: true, at }
const declined = { ...accepted, analytics: false }

/** Подделка документа: запоминает каждый добавленный скрипт (= каждый сетевой запрос к Метрике). */
const fakePage = (cookie = '') => {
  const scripts: { async: boolean; src: string }[] = []
  const cookies: string[] = []
  const doc = {
    createElement: () => ({ async: false, src: '' }),
    head: { appendChild: (node: unknown) => scripts.push(node as (typeof scripts)[number]) },
    get cookie() {
      return cookie
    },
    set cookie(value: string) {
      cookies.push(value)
    },
    location: { hostname: 'www.teatrturdus.ru' },
  }
  const win: { ym?: ((...args: unknown[]) => void) & { a?: unknown[][] } } = {}
  return { doc, win, scripts, cookies }
}

describe('cookie consent value', () => {
  it('round-trips without personal data', () => {
    const raw = serializeCookieConsent(accepted)
    expect(raw).toBe(`${COOKIE_CONSENT_VERSION}.a.${at.getTime() / 1000}`)
    expect(parseCookieConsent(raw)).toEqual(accepted)
    expect(parseCookieConsent(serializeCookieConsent(declined))?.analytics).toBe(false)
  })

  it('treats another text version or garbage as no decision', () => {
    expect(parseCookieConsent(serializeCookieConsent({ ...accepted, version: 'old-1' }))).toBeNull()
    expect(parseCookieConsent('yes')).toBeNull()
    expect(parseCookieConsent('')).toBeNull()
    expect(parseCookieConsent(null)).toBeNull()
  })

  it('reads its cookie out of document.cookie', () => {
    const raw = serializeCookieConsent(accepted)
    expect(readCookie(`a=1; ${COOKIE_CONSENT_NAME}=${raw}; b=2`, COOKIE_CONSENT_NAME)).toBe(raw)
    expect(readCookie('a=1', COOKIE_CONSENT_NAME)).toBeNull()
  })

  it('is a first-party, Lax, time-limited cookie; Secure on https', () => {
    const header = cookieConsentHeader(accepted, true)
    expect(header).toMatch(new RegExp(`^${COOKIE_CONSENT_NAME}=`))
    expect(header).toContain('Path=/')
    expect(header).toContain('SameSite=Lax')
    expect(header).toMatch(/Max-Age=\d+/)
    expect(header).toContain('Secure')
    expect(cookieConsentHeader(accepted, false)).not.toContain('Secure')
  })
})

describe('Metrika gate', () => {
  it('needs both a configured counter and an explicit yes', () => {
    expect(mayLoadAnalytics(accepted, '12345678')).toBe(true)
    expect(mayLoadAnalytics(null, '12345678')).toBe(false)
    expect(mayLoadAnalytics(declined, '12345678')).toBe(false)
    expect(mayLoadAnalytics(accepted, null)).toBe(false)
  })

  it('accepts only a numeric counter id', () => {
    expect(parseMetrikaId(' 12345678 ')).toBe('12345678')
    expect(parseMetrikaId('')).toBeNull()
    expect(parseMetrikaId(undefined)).toBeNull()
    expect(parseMetrikaId('123"><script>')).toBeNull()
  })
})

describe('Metrika loader', () => {
  it('makes no request to Metrika before consent', () => {
    const page = fakePage()
    const metrika = createMetrikaLoader({ counterId: '12345678', ...page })
    expect(metrika.apply(null)).toBe(false)
    metrika.hit('https://teatrturdus.ru/afisha')
    expect(page.scripts).toEqual([])
    expect(page.win.ym).toBeUndefined()
  })

  it('makes no request after «Только необходимые»', () => {
    const page = fakePage()
    const metrika = createMetrikaLoader({ counterId: '12345678', ...page })
    expect(metrika.apply(parseCookieConsent(serializeCookieConsent(declined)))).toBe(false)
    expect(page.scripts).toEqual([])
    expect(page.win.ym).toBeUndefined()
  })

  it('makes no request without a counter id, even with consent', () => {
    const page = fakePage()
    expect(createMetrikaLoader({ counterId: null, ...page }).apply(accepted)).toBe(false)
    expect(page.scripts).toEqual([])
  })

  it('loads tag.js once after consent and queues init without the session recorder', () => {
    const page = fakePage()
    const metrika = createMetrikaLoader({ counterId: '12345678', ...page })
    expect(metrika.apply(accepted)).toBe(true)
    expect(metrika.apply(accepted)).toBe(false)
    expect(page.scripts).toEqual([{ async: true, src: METRIKA_SRC }])
    expect(page.win.ym?.a?.[0]).toEqual([
      12345678,
      'init',
      expect.objectContaining({ webvisor: false }),
    ])
    metrika.hit('https://teatrturdus.ru/afisha', 'https://teatrturdus.ru/')
    expect(page.win.ym?.a?.[1]).toEqual([
      12345678,
      'hit',
      'https://teatrturdus.ru/afisha',
      { referer: 'https://teatrturdus.ru/' },
    ])
  })

  it('wipes Metrika cookies on withdrawal and asks for a reload only if it was running', () => {
    const before = fakePage('_ym_uid=1; turdus_session=x; _ym_d=2')
    const idle = createMetrikaLoader({ counterId: '12345678', ...before })
    expect(idle.revoke()).toBe(false)
    const wiped = before.cookies.map((c) => c.split('=')[0])
    expect(new Set(wiped)).toEqual(new Set(['_ym_uid', '_ym_d']))
    expect(before.cookies.some((c) => c.includes('Domain=.teatrturdus.ru'))).toBe(true)

    const running = fakePage()
    const metrika = createMetrikaLoader({ counterId: '12345678', ...running })
    metrika.apply(accepted)
    expect(metrika.revoke()).toBe(true)
  })
})
