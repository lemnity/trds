import {
  APIError,
  ValidationError,
  type CollectionAfterChangeHook,
  type CollectionBeforeDeleteHook,
  type PayloadRequest,
} from 'payload'

import { plural } from '@/lib/plural'
// Не через '@/modules/inventory': его вход импортирует @payload-config (цикл с этим конфигом).
import {
  capacityFromPerformance,
  createInventoryService,
  type InventoryService,
} from '@/modules/inventory/inventory'
import { pgCommerceStore } from '@/modules/inventory/pgStore'
import type { Performance } from '@/modules/shows'

import { transactionDb } from '../db'

/**
 * CMS → inventory (rules.md §2, architecture.md §5). CMS хранит цену и квоту категории, но
 * остаток не пишет: после сохранения показа/категории вызывается `syncCapacity` в той же
 * транзакции. Отказ (вместимость ниже `sold + held`) — ошибка валидации: правка в CMS
 * откатывается целиком, inventory не меняется.
 */

export const PERFORMANCES_SLUG = 'performances'
export const TICKET_TYPES_SLUG = 'ticket-types'

type Id = number | string
type PerformanceDoc = {
  id: Id
  code: string
  startsAt?: string | null
  _status?: 'draft' | 'published' | null
  seating?: {
    planId?: string | null
    unavailableSeatIds?: string[] | null
  } | null
}
type TicketTypeDoc = {
  id: Id
  code: string
  title?: string | null
  capacity?: number | null
  priceKopecks?: number | null
  performance?: Id | { id: Id } | null
}

export type InventoryFor = (req: PayloadRequest) => Promise<Pick<InventoryService, 'syncCapacity'>>

const defaultInventory: InventoryFor = async (req) =>
  createInventoryService({
    store: pgCommerceStore(await transactionDb<Parameters<typeof pgCommerceStore>[0]>(req)),
  })

const idOf = (ref: TicketTypeDoc['performance']) =>
  ref && typeof ref === 'object' ? ref.id : (ref ?? null)

/** Что продаётся на показе: категории (с заменой/удалением одной) и схема зала. */
export const inventoryPerformance = (
  perf: PerformanceDoc,
  types: TicketTypeDoc[],
  override?: { code: string; capacity: number },
): Performance => {
  const ticketTypes = types.map((t) => ({
    id: t.code,
    title: t.title ?? t.code,
    priceKopecks: t.priceKopecks ?? 0,
    capacity: override?.code === t.code ? override.capacity : (t.capacity ?? 0),
  }))
  return {
    id: perf.code,
    showSlug: '',
    venueId: '',
    startsAt: perf.startsAt ?? '',
    ticketTypes,
    ...(perf.seating?.planId && {
      seating: {
        planId: perf.seating.planId,
        pricesKopecks: {},
        unavailableSeatIds: perf.seating.unavailableSeatIds ?? [],
      },
    }),
  }
}

const loadTypes = async (req: PayloadRequest, performanceId: Id) =>
  (
    await req.payload.find({
      collection: TICKET_TYPES_SLUG,
      where: { performance: { equals: performanceId } },
      depth: 0,
      pagination: false,
      overrideAccess: true,
      req,
    })
  ).docs as unknown as TicketTypeDoc[]

const loadPerformance = async (req: PayloadRequest, id: Id) =>
  (await req.payload.findByID({
    collection: PERFORMANCES_SLUG,
    id,
    depth: 0,
    overrideAccess: true,
    req,
  })) as unknown as PerformanceDoc

const ticketsWord = (n: number) => plural(n, 'билет', 'билета', 'билетов')

async function sync(
  req: PayloadRequest,
  inventoryFor: InventoryFor,
  perf: Performance,
  collection: string,
  path: string,
) {
  const result = await (await inventoryFor(req)).syncCapacity(capacityFromPerformance(perf))
  if (result.ok) return result
  throw new ValidationError({
    collection,
    errors: result.conflicts.map((c) => ({
      path,
      message: `Нельзя меньше проданного и забронированного: «${c.ticketTypeId}» — уже ${c.committed} ${ticketsWord(c.committed)}, указано ${c.capacity}.`,
    })),
    req,
  })
}

/** Категория билетов сохранена → синхронизировать вместимость всего показа. */
export const syncTicketTypeCapacity =
  (inventoryFor: InventoryFor = defaultInventory): CollectionAfterChangeHook<TicketTypeDoc> =>
  async ({ doc, req }) => {
    const performanceId = idOf(doc.performance)
    if (performanceId === null) return doc
    const perf = await loadPerformance(req, performanceId)
    const types = await loadTypes(req, performanceId)
    await sync(req, inventoryFor, inventoryPerformance(perf, types), TICKET_TYPES_SLUG, 'capacity')
    return doc
  }

/** Удаление категории: сначала обнулить её вместимость; если есть проданные — отказ. */
export const guardTicketTypeDelete =
  (inventoryFor: InventoryFor = defaultInventory): CollectionBeforeDeleteHook =>
  async ({ id, req }) => {
    const type = (await req.payload.findByID({
      collection: TICKET_TYPES_SLUG,
      id,
      depth: 0,
      overrideAccess: true,
      req,
    })) as unknown as TicketTypeDoc
    const performanceId = idOf(type.performance)
    if (performanceId === null) return
    const perf = await loadPerformance(req, performanceId)
    const types = await loadTypes(req, performanceId)
    await sync(
      req,
      inventoryFor,
      inventoryPerformance(perf, types, { code: type.code, capacity: 0 }),
      TICKET_TYPES_SLUG,
      'capacity',
    )
  }

/** Опубликованный показ со схемой зала → места в inventory (добавить, закрыть снятые). */
export const syncPerformanceSeating =
  (inventoryFor: InventoryFor = defaultInventory): CollectionAfterChangeHook<PerformanceDoc> =>
  async ({ doc, req }) => {
    if (doc._status === 'draft') return doc
    const types = await loadTypes(req, doc.id)
    if (!doc.seating?.planId && types.length === 0) return doc
    await sync(req, inventoryFor, inventoryPerformance(doc, types), PERFORMANCES_SLUG, 'seating')
    return doc
  }

/** Показ с категориями или схемой не удаляется: снимите с публикации (заказы ссылаются на него). */
export const guardPerformanceDelete: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const types = await loadTypes(req, id)
  const perf = await loadPerformance(req, id)
  if (types.length > 0 || perf.seating?.planId)
    throw new APIError(
      'Показ с билетами нельзя удалить — снимите его с публикации или удалите категории.',
      400,
      undefined,
      true,
    )
}
