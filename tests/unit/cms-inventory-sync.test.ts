import { APIError, ValidationError, formatErrors, type PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'

import { createInventoryService } from '../../src/modules/inventory/inventory'
import { memoryCommerceStore } from '../../src/modules/inventory/memoryStore'
import type { SeatRow } from '../../src/modules/inventory/store'
import {
  PERFORMANCE_DELETE_CONTEXT,
  guardPerformanceDelete,
  guardShowDelete,
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
  performancesOfShow = 0,
) => {
  const store = memoryCommerceStore()
  const inventory = createInventoryService({ store })
  const deleted: unknown[] = []
  const counted: unknown[] = []
  const req = {
    context: {},
    payload: {
      find: async ({ collection }: { collection: string }) => ({
        docs: collection === 'ticket-types' ? types : [],
      }),
      findByID: async ({ collection, id }: { collection: string; id: number }) =>
        collection === 'performances' ? performance : types.find((t) => t.id === id),
      delete: async (args: { context?: Record<string, unknown> }) => {
        deleted.push(args)
        Object.assign(req.context, args.context)
        return { docs: types, errors: [] }
      },
      count: async (args: unknown) => {
        counted.push(args)
        return { totalDocs: performancesOfShow }
      },
    },
  } as unknown as PayloadRequest
  const sold = (ticketTypeId: string, n: number, capacity = 20, held = 0) =>
    store.transaction((tx) =>
      tx.insertInventory({
        performanceId: 'guests-1115',
        ticketTypeId,
        capacity,
        sold: n,
        held,
        updatedAt: NOW,
      }),
    )
  const row = (ticketTypeId: string) =>
    store.dump().inventory.find((r) => r.ticketTypeId === ticketTypeId)
  return { req, inventoryFor: async () => inventory, sold, row, store, deleted, counted }
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
        label: 'Вместимость (квота)',
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
})

const REFUSED =
  'Показ с проданными или забронированными билетами нельзя удалить — снимите его с публикации.'
const seated = {
  id: 1,
  code: 'guests-1115',
  _status: 'published',
  seating: { planId: 'dom-aktera', unavailableSeatIds: [] as string[] },
}
const seat = (seatId: string, status: 'sold' | 'held' | 'free'): SeatRow => ({
  performanceId: 'guests-1115',
  seatId,
  planId: 'dom-aktera',
  planVersion: 1,
  categoryId: 'a',
  status,
  holdId: status === 'held' ? 'hold-1' : null,
  orderId: status === 'free' ? null : 'order-1',
  updatedAt: NOW,
})

describe('performance delete: by sales, inventory removed with it', () => {
  it('a never-sold performance with seats and categories is deleted; its inventory and categories go too', async () => {
    const types = [type(1, 'standard', 20)]
    const { req, inventoryFor, store, deleted } = setup(types, seated)
    await syncPerformanceSeating(inventoryFor)({ doc: seated, req } as never)
    // Ещё один показ с продажей — его inventory не трогаем.
    await store.transaction((tx) =>
      tx.insertInventory({
        performanceId: 'other-1116',
        ticketTypeId: 'standard',
        capacity: 5,
        sold: 1,
        held: 0,
        updatedAt: NOW,
      }),
    )
    expect(store.dump().seats.length).toBeGreaterThan(100)

    await expect(
      guardPerformanceDelete(inventoryFor)({ id: 1, req } as never),
    ).resolves.toBeUndefined()

    expect(store.dump().seats.filter((s) => s.performanceId === 'guests-1115')).toEqual([])
    expect(store.dump().inventory).toEqual([
      expect.objectContaining({ performanceId: 'other-1116' }),
    ])
    // Категории билетов показа удаляются вместе с ним (performance_id NOT NULL), без их guard-синхронизации.
    expect(deleted).toEqual([
      expect.objectContaining({
        collection: 'ticket-types',
        where: { performance: { equals: 1 } },
        overrideAccess: true,
        req,
        context: { [PERFORMANCE_DELETE_CONTEXT]: true },
      }),
    ])
  })

  it.each<[string, { seat?: SeatRow; sold?: [number, number] }]>([
    ['a sold seat', { seat: seat('A-1', 'sold') }],
    ['a held seat', { seat: seat('A-1', 'held') }],
    ['sold tickets of a category', { sold: [2, 0] }],
    ['held tickets of a category', { sold: [0, 3] }],
  ])('refuses with %s; nothing is removed', async (_, given) => {
    const types = [type(1, 'standard', 20)]
    const { req, inventoryFor, store, sold, deleted } = setup(types, seated)
    await sold('standard', given.sold?.[0] ?? 0, 20, given.sold?.[1] ?? 0)
    const taken = given.seat
    if (taken) await store.transaction((tx) => tx.insertSeats([seat('A-2', 'free'), taken]))
    const before = store.dump()

    const error = await guardPerformanceDelete(inventoryFor)({ id: 1, req } as never).catch(
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(APIError)
    expect(error).toMatchObject({ message: REFUSED, status: 400, isPublic: true })
    expect(store.dump().seats).toEqual(before.seats)
    expect(store.dump().inventory).toEqual(before.inventory)
    expect(deleted).toEqual([])
  })

  it('refuses when the performance has order items, even after the seats were returned', async () => {
    const { req, inventoryFor, store } = setup([], seated)
    await store.transaction(async (tx) => {
      await tx.insertSeats([seat('A-1', 'free')])
      await tx.insertItems([
        {
          id: 'item-1',
          orderId: 'order-1',
          performanceId: 'guests-1115',
          ticketTypeId: 'a',
          seatId: 'A-1',
          titleSnapshot: 'A-1',
          showTitleSnapshot: null,
          showSlugSnapshot: null,
          startsAtSnapshot: null,
          venueTitleSnapshot: null,
          venueAddressSnapshot: null,
          unitPriceKopecks: 100_000,
          quantity: 1,
          lineGrossKopecks: 100_000,
          lineBonusKopecks: 0,
          lineCashKopecks: 100_000,
          lineFeeKopecks: 0,
        },
      ])
    })
    await expect(
      guardPerformanceDelete(inventoryFor)({ id: 1, req } as never),
    ).rejects.toMatchObject({
      message: REFUSED,
    })
    expect(store.dump().seats).toHaveLength(1)
  })

  it('a performance without inventory or categories is deleted as is', async () => {
    const { req, inventoryFor } = setup([])
    await expect(
      guardPerformanceDelete(inventoryFor)({ id: 1, req } as never),
    ).resolves.toBeUndefined()
  })

  it('category deletion during a performance delete does not resync the inventory', async () => {
    const types = [type(1, 'standard', 20), type(2, 'vip', 5)]
    const { req, inventoryFor, store } = setup(types)
    req.context = { [PERFORMANCE_DELETE_CONTEXT]: true }
    await guardTicketTypeDelete(inventoryFor)({ id: 1, req, context: req.context } as never)
    expect(store.dump().inventory).toEqual([])
  })

  it('the refusal reaches the admin: public 400 APIError, message kept by Payload error formatting', async () => {
    const { req, inventoryFor, sold } = setup([type(1, 'standard', 20)])
    await sold('standard', 1)
    const error = (await guardPerformanceDelete(inventoryFor)({ id: 1, req } as never).catch(
      (e: unknown) => e,
    )) as APIError
    // Одиночное удаление: routeError → formatErrors → toast(errors[i].message), если isPublic.
    expect(formatErrors(error).errors).toEqual([expect.objectContaining({ message: REFUSED })])
    // Массовое: delete operation кладёт { message, isPublic } в errors, toast — описанием.
    expect(error.isPublic).toBe(true)
  })
})

describe('performance delete: ticket categories cannot be removed', () => {
  it('surfaces as a public 400 with a Russian message and logs the cause', async () => {
    const { req, inventoryFor } = setup([type(1, 'standard', 20)])
    const logged: unknown[] = []
    const payload = req.payload as unknown as Record<string, unknown>
    payload.logger = { error: (...a: unknown[]) => logged.push(a) }
    payload.delete = async () => ({ docs: [], errors: [{ id: 1, message: 'db down' }] })
    const error = (await guardPerformanceDelete(inventoryFor)({ id: 1, req } as never).catch(
      (e: unknown) => e,
    )) as APIError
    expect(error).toBeInstanceOf(APIError)
    expect(error.status).toBe(400)
    expect(error.isPublic).toBe(true)
    expect(error.message).toBe(
      'Не удалось удалить категории билетов показа — повторите или удалите их вручную.',
    )
    expect(JSON.stringify(logged)).toContain('db down')
  })
})

describe('show delete', () => {
  it('a show with performances cannot be deleted; the message counts them', async () => {
    const { req, counted } = setup([], undefined, 3)
    const error = (await guardShowDelete({ id: 7, req } as never).catch(
      (e: unknown) => e,
    )) as APIError
    expect(error).toBeInstanceOf(APIError)
    expect(error).toMatchObject({
      message:
        'У спектакля есть показы (3) — сначала удалите их или перенесите на другой спектакль.',
      status: 400,
      isPublic: true,
    })
    expect(counted).toEqual([
      expect.objectContaining({
        collection: 'performances',
        where: { show: { equals: 7 } },
        overrideAccess: true,
        req,
      }),
    ])
  })

  it('a show without performances is deleted', async () => {
    const { req } = setup([], undefined, 0)
    await expect(guardShowDelete({ id: 7, req } as never)).resolves.toBeUndefined()
  })
})
