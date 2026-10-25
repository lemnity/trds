import { describe, expect, it } from 'vitest'

import {
  ORDER_TRANSITIONS,
  isSettled,
  transition,
  type OrderEvent,
  type OrderStatus,
} from '../../src/modules/checkout'

const AT = new Date('2026-11-23T14:00:00Z')
const STATUSES: OrderStatus[] = [
  'DRAFT',
  'PENDING_PAYMENT',
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'EXPIRED',
  'CANCELLED',
  'NEEDS_REVIEW',
]
const EVENTS: OrderEvent[] = [
  { type: 'HOLD_PLACED', holdUntil: AT },
  { type: 'PAYMENT_CONFIRMED', at: AT },
  { type: 'LATE_PAYMENT_ALLOCATED', at: AT },
  { type: 'REVIEW_REQUIRED', at: AT, reason: 'LATE_PAYMENT_NO_STOCK' },
  { type: 'HOLD_EXPIRED', at: AT },
  { type: 'CANCELLED', at: AT },
  { type: 'REFUNDED_PARTIALLY', at: AT },
  { type: 'REFUNDED_FULLY', at: AT },
]
const event = (type: OrderEvent['type']) => EVENTS.find((e) => e.type === type)!

const run = (from: OrderStatus, ...types: OrderEvent['type'][]) =>
  types.reduce<OrderStatus>((status, type) => {
    const r = transition({ status }, event(type))
    if (!r.ok) throw new Error(`${status} -/-> ${type}`)
    return r.to
  }, from)

describe('order state machine', () => {
  it('happy path: draft → pending → paid → partially refunded → refunded', () => {
    expect(
      run('DRAFT', 'HOLD_PLACED', 'PAYMENT_CONFIRMED', 'REFUNDED_PARTIALLY', 'REFUNDED_FULLY'),
    ).toBe('REFUNDED')
    expect(transition({ status: 'DRAFT' }, event('HOLD_PLACED'))).toEqual({
      ok: true,
      from: 'DRAFT',
      to: 'PENDING_PAYMENT',
      patch: { holdUntil: AT },
    })
    expect(transition({ status: 'PENDING_PAYMENT' }, event('PAYMENT_CONFIRMED'))).toMatchObject({
      to: 'PAID',
      patch: { paidAt: AT, holdUntil: null },
    })
  })

  it('pending payment ends as expired, cancelled or needs review', () => {
    expect(run('PENDING_PAYMENT', 'HOLD_EXPIRED')).toBe('EXPIRED')
    expect(run('PENDING_PAYMENT', 'CANCELLED')).toBe('CANCELLED')
    expect(transition({ status: 'PENDING_PAYMENT' }, event('REVIEW_REQUIRED'))).toMatchObject({
      to: 'NEEDS_REVIEW',
      patch: { reviewReason: 'LATE_PAYMENT_NO_STOCK' },
    })
  })

  it('late payment: expired/cancelled → paid when stock is re-acquired, else needs review', () => {
    expect(run('EXPIRED', 'LATE_PAYMENT_ALLOCATED')).toBe('PAID')
    expect(run('CANCELLED', 'LATE_PAYMENT_ALLOCATED')).toBe('PAID')
    expect(run('EXPIRED', 'REVIEW_REQUIRED', 'REFUNDED_FULLY')).toBe('REFUNDED')
    // Обычное подтверждение для просроченного заказа не проходит — только через политику.
    expect(transition({ status: 'EXPIRED' }, event('PAYMENT_CONFIRMED'))).toMatchObject({
      ok: false,
      error: 'INVALID_TRANSITION',
    })
  })

  it('repeating an applied event is a no-op, not an error (duplicate webhook, worker rerun)', () => {
    for (const [status, type] of [
      ['PAID', 'PAYMENT_CONFIRMED'],
      ['EXPIRED', 'HOLD_EXPIRED'],
      ['CANCELLED', 'CANCELLED'],
      ['NEEDS_REVIEW', 'REVIEW_REQUIRED'],
      ['REFUNDED', 'REFUNDED_FULLY'],
    ] as const)
      expect(transition({ status }, event(type))).toEqual({
        ok: true,
        from: status,
        to: status,
        noop: true,
      })
  })

  it('forbidden transitions are rejected', () => {
    for (const [status, type] of [
      ['DRAFT', 'PAYMENT_CONFIRMED'],
      ['PAID', 'HOLD_EXPIRED'],
      ['PAID', 'CANCELLED'],
      ['REFUNDED', 'PAYMENT_CONFIRMED'],
      ['REFUNDED', 'REFUNDED_PARTIALLY'],
      ['EXPIRED', 'HOLD_PLACED'],
      ['PENDING_PAYMENT', 'REFUNDED_FULLY'],
      ['CANCELLED', 'HOLD_EXPIRED'],
    ] as const)
      expect(transition({ status }, event(type))).toEqual({
        ok: false,
        error: 'INVALID_TRANSITION',
        from: status,
        event: type,
      })
  })

  it('every status × event is either a listed transition, a no-op or rejected', () => {
    let allowed = 0
    for (const status of STATUSES)
      for (const e of EVENTS) {
        const r = transition({ status }, e)
        const listed = ORDER_TRANSITIONS[e.type][status]
        if (listed) {
          allowed++
          expect(r).toMatchObject({ ok: true, to: listed })
        } else if (r.ok) expect(r).toMatchObject({ noop: true, to: status })
        else expect(r.error).toBe('INVALID_TRANSITION')
      }
    expect(allowed).toBe(17)
    // Из возвращённого заказа не выйти ничем, кроме no-op.
    expect(EVENTS.every((e) => !('patch' in transition({ status: 'REFUNDED' }, e)))).toBe(true)
  })

  it('isSettled', () => {
    expect(STATUSES.filter(isSettled)).toEqual(['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'])
  })
})
