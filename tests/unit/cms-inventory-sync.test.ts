import { APIError, ValidationError, type PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'

import { createInventoryService } from '../../src/modules/inventory/inventory'
import { memoryCommerceStore } from '../../src/modules/inventory/memoryStore'
import {
  guardPerformanceDelete,
  guardTicketTypeDelete,
  syncPerformanceSeating,
  syncTicketTypeCapacity,
} from '../../src/payload/hooks/inventorySync'

// rules.md §2: CMS хранит цену и квоту, но остаток не пишет — только через syncCapacity, которая
// не даёт опустить вместимость ниже sold + held. Отказ — ошибка валидации поля в CMS.
const NOW = new Date('2026-11-20T10:00:00Z')

type Doc = Record<string, unknown> & { id: number }

const setup = (
  types: Doc[],
  performance: Doc = { id: 1, code: 'guests-1115', startsAt: '2026-11-15T13:00:00.000Z' },
) => {
  const store = memoryCommerceStore()
  const inventory = createInventoryService({ store })
  const req = {
    payload: {
      find: async ({ collection }: { collection: string }) => ({
        docs: collection === 'ticket-types' ? types : [],
      }),
      findByID: async ({ collection, id }: { collection: string; id: number }) =>
        collection === 'performances' ? performance : types.find((t) => t.id === id),
    },
  } as unknown as PayloadRequest
  const sold = (ticketTypeId: string, n: number, capacity = 20) =>
    store.transaction((tx) =>
      tx.insertInventory({
        performanceId: 'guests-1115',
        ticketTypeId,
        capacity,
        sold: n,
        held: 0,
        updatedAt: NOW,
      }),
    )
  const row = (ticketTypeId: string) =>
    store.dump().inventory.find((r) => r.ticketTypeId === ticketTypeId)
  return { req, inventoryFor: async () => inventory, sold, row, store }
}

const type = (id: number, code: string, capacity: number): Doc => ({
  id,
  code,
  title: code,
  capacity,
  priceKopecks: 100_000,
  performance: 1,
})

describe('ticket type → inventory (syncCapacity)', () => {
  it('creates and updates inventory capacity for the whole performance', async () => {
    const types = [type(1, 'standard', 20), type(2, 'vip', 5)]
    const { req, inventoryFor, row } = setup(types)
    const hook = syncTicketTypeCapacity(inventoryFor)
    await hook({ doc: types[0], req } as never)
    expect(row('standard')).toMatchObject({ capacity: 20, sold: 0 })
    expect(row('vip')).toMatchObject({ capacity: 5 })
    types[0]!.capacity = 30
    await hook({ doc: types[0], req } as never)
    expect(row('standard')?.capacity).toBe(30)
  })

  it('refuses capacity below sold + held as a field validation error; inventory unchanged', async () => {
    const types = [type(1, 'standard', 3)]
    const { req, inventoryFor, sold, row } = setup(types)
    await sold('standard', 5)
    const hook = syncTicketTypeCapacity(inventoryFor)
    const error = await hook({ doc: types[0], req } as never).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).data.errors).toEqual([
      {
        path: 'capacity',
        message:
          'Нельзя меньше проданного и забронированного: «standard» — уже 5 билетов, указано 3.',
      },
    ])
    expect(row('standard')).toMatchObject({ capacity: 20, sold: 5 })
  })

  it('deleting a category with sold tickets is refused; an unsold one is zeroed', async () => {
    const types = [type(1, 'standard', 20), type(2, 'vip', 5)]
    const { req, inventoryFor, sold, row } = setup(types)
    await sold('standard', 2)
    const guard = guardTicketTypeDelete(inventoryFor)
    await expect(guard({ id: 1, req } as never)).rejects.toBeInstanceOf(ValidationError)
    await guard({ id: 2, req } as never)
    expect(row('vip')?.capacity).toBe(0)
  })
})

describe('performance → inventory', () => {
  it('a published performance with a seating plan adds seats; a draft does not sync', async () => {
    const perf = {
      id: 1,
      code: 'guests-1115',
      _status: 'published',
      seating: { planId: 'dom-aktera', unavailableSeatIds: [] },
    }
    const { req, inventoryFor, store } = setup([], perf)
    const hook = syncPerformanceSeating(inventoryFor)
    await hook({ doc: { ...perf, _status: 'draft' }, req } as never)
    expect(store.dump().seats).toHaveLength(0)
    await hook({ doc: perf, req } as never)
    expect(store.dump().seats.length).toBeGreaterThan(100)
  })

  it('a performance with ticket categories cannot be deleted (unpublish instead)', async () => {
    const { req } = setup([type(1, 'standard', 20)])
    await expect(guardPerformanceDelete({ id: 1, req } as never)).rejects.toBeInstanceOf(APIError)
    const empty = setup([])
    await expect(
      guardPerformanceDelete({ id: 1, req: empty.req } as never),
    ).resolves.toBeUndefined()
  })
})
