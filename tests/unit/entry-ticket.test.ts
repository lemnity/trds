import { describe, expect, it } from 'vitest'

import {
  entrySeats,
  entryTicketState,
  showIdOf,
  type EntryTicketInput,
} from '@/payload/components/tickets/entryTicket'

const base: EntryTicketInput = {
  saved: true,
  planId: '',
  seats: 10,
  canCreate: true,
  hasCategories: false,
}

describe('entryTicketState', () => {
  it('shows the button with the show capacity', () => {
    expect(entryTicketState(base)).toEqual({ kind: 'button', seats: 10 })
  })
  it('asks to save first when unsaved', () => {
    expect(entryTicketState({ ...base, saved: false })).toEqual({ kind: 'save-first' })
  })
  it('hides with a hall scheme, no seats or no permission', () => {
    expect(entryTicketState({ ...base, planId: 'main' })).toEqual({ kind: 'hidden' })
    expect(entryTicketState({ ...base, seats: undefined })).toEqual({ kind: 'hidden' })
    expect(entryTicketState({ ...base, seats: 0 })).toEqual({ kind: 'hidden' })
    expect(entryTicketState({ ...base, canCreate: false, saved: false })).toEqual({
      kind: 'hidden',
    })
  })
  it('hides when categories exist or are still unknown', () => {
    expect(entryTicketState({ ...base, hasCategories: true })).toEqual({ kind: 'hidden' })
    expect(entryTicketState({ ...base, hasCategories: null })).toEqual({ kind: 'hidden' })
  })
})

describe('entrySeats / showIdOf', () => {
  it('validates seats', () => {
    expect(entrySeats(50)).toBe(50)
    expect(entrySeats(1.5)).toBeNull()
    expect(entrySeats('10')).toBeNull()
  })
  it('reads show id from id or object', () => {
    expect(showIdOf(7)).toBe(7)
    expect(showIdOf('abc')).toBe('abc')
    expect(showIdOf({ id: 3 })).toBe(3)
    expect(showIdOf(null)).toBeNull()
    expect(showIdOf('')).toBeNull()
  })
})
