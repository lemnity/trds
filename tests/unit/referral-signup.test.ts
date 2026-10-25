import { describe, expect, it } from 'vitest'

import { normalizeReferralCode } from '../../src/modules/loyalty'
import { createWalletService, memoryWalletStore } from '../../src/modules/wallet/service'
import { attachReferralOnSignup } from '../../src/modules/wallet/signup'

const now = new Date('2026-10-25T10:00:00Z')
const FRIEND = '00000000-0000-4000-8000-000000000001'
const NEWBIE = '00000000-0000-4000-8000-000000000002'

const wallet = () =>
  createWalletService({ store: memoryWalletStore(), secret: 'test-secret-test-secret-123456' })

describe('normalizeReferralCode', () => {
  it('accepts the code from the link in any case, rejects anything else', () => {
    expect(normalizeReferralCode(' ab12cd34 ')).toBe('AB12CD34')
    expect(normalizeReferralCode('')).toBeNull()
    expect(normalizeReferralCode(null)).toBeNull()
    expect(normalizeReferralCode('../../x')).toBeNull()
    expect(normalizeReferralCode('A'.repeat(17))).toBeNull()
  })
})

describe('attachReferralOnSignup', () => {
  it('links a newly registered friend to the inviter', async () => {
    const w = wallet()
    const code = (await w.summary(FRIEND, now)).referral.code
    expect(
      await attachReferralOnSignup(w.attachReferral, {
        created: true,
        customerId: NEWBIE,
        ref: code.toLowerCase(),
        now,
      }),
    ).toBe('attached')
    // Второй раз тот же друг не привязывается.
    expect(
      await attachReferralOnSignup(w.attachReferral, {
        created: true,
        customerId: NEWBIE,
        ref: code,
        now,
      }),
    ).toBe('rejected')
  })

  it('ignores the link for an account that already existed (a logged-in user opened it)', async () => {
    const w = wallet()
    const code = (await w.summary(FRIEND, now)).referral.code
    let called = false
    expect(
      await attachReferralOnSignup(
        async (...args) => {
          called = true
          return w.attachReferral(...args)
        },
        { created: false, customerId: NEWBIE, ref: code, now },
      ),
    ).toBe('skipped')
    expect(called).toBe(false)
  })

  it('skips a missing or malformed code', async () => {
    const w = wallet()
    for (const ref of [undefined, null, '', 'not a code!'])
      expect(
        await attachReferralOnSignup(w.attachReferral, {
          created: true,
          customerId: NEWBIE,
          ref,
          now,
        }),
      ).toBe('skipped')
  })

  it('rejects an unknown code and self-invites without failing the sign-up', async () => {
    const w = wallet()
    expect(
      await attachReferralOnSignup(w.attachReferral, {
        created: true,
        customerId: NEWBIE,
        ref: 'ZZZZZZZZ',
        now,
      }),
    ).toBe('rejected')
    const own = (await w.summary(NEWBIE, now)).referral.code
    expect(
      await attachReferralOnSignup(w.attachReferral, {
        created: true,
        customerId: NEWBIE,
        ref: own,
        now,
      }),
    ).toBe('rejected')
  })

  it('swallows storage errors: registration is already done', async () => {
    expect(
      await attachReferralOnSignup(
        async () => {
          throw new Error('db down')
        },
        { created: true, customerId: NEWBIE, ref: 'AB12CD34', now },
      ),
    ).toBe('failed')
  })
})
