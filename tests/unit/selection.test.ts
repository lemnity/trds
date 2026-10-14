import { describe, expect, it } from 'vitest'

import { selectionFromSearch, selectionToSearch, type Selection } from '../../src/modules/checkout'

describe('selection in the checkout URL', () => {
  it('encodes ticket quantities without zero lines', () => {
    expect(
      selectionToSearch({ kind: 'tickets', quantities: { entry: 1, 'stage-table': 2, vip: 0 } }),
    ).toBe('tickets=entry%3A1%2Cstage-table%3A2')
  })

  it('encodes seats', () => {
    expect(selectionToSearch({ kind: 'seats', seatIds: ['r1-s3', 'r12-s9'] })).toBe(
      'seats=r1-s3%2Cr12-s9',
    )
  })

  it('round-trips both kinds', () => {
    const tickets: Selection = { kind: 'tickets', quantities: { entry: 1, 'stage-table': 2 } }
    const seats: Selection = { kind: 'seats', seatIds: ['r1-s3', 'r12-s9'] }
    expect(selectionFromSearch(new URLSearchParams(selectionToSearch(tickets)))).toEqual(tickets)
    expect(selectionFromSearch(new URLSearchParams(selectionToSearch(seats)))).toEqual(seats)
  })

  it('rejects malformed or empty input instead of guessing', () => {
    for (const query of [
      '',
      'tickets=',
      'tickets=entry',
      'tickets=entry:0',
      'tickets=entry:1.5',
      'tickets=entry:-1',
      'tickets=Entry!:1',
      'seats=',
      'seats=r1-s3,,r2',
      'tickets=entry:1&seats=r1-s1',
    ]) {
      expect(selectionFromSearch(new URLSearchParams(query)), query).toBeNull()
    }
  })
})
