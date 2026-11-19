import { describe, expect, it, vi } from 'vitest'

import {
  buildPerformanceTitle,
  formatPerformanceMoment,
  refreshPerformanceTitles,
  setPerformanceTitle,
  titleChanged,
} from '@/payload/hooks/performanceTitle'

describe('название показа', () => {
  it('дата и время — в поясе театра, месяц по-русски', () => {
    expect(formatPerformanceMoment('2027-03-15T14:00:00.000Z')).toBe('15 марта 19:00')
    expect(formatPerformanceMoment('2026-11-05T19:30:00.000Z')).toBe('6 ноября 00:30')
  })

  it('собирается из спектакля, времени и площадки', () => {
    expect(
      buildPerformanceTitle({
        showTitle: 'Преступление и наказание',
        startsAt: '2026-11-23T14:00:00.000Z',
        venueTitle: 'Дом актёра',
      }),
    ).toBe('Преступление и наказание · 23 ноября 19:00 · Дом актёра')
  })

  it('пропускает отсутствующие части', () => {
    expect(buildPerformanceTitle({ showTitle: 'Гости', startsAt: null, venueTitle: null })).toBe(
      'Гости',
    )
  })

  it('хук берёт спектакль и площадку по id и учитывает исходный документ', async () => {
    const findByID = vi.fn(async ({ collection }: { collection: string }) =>
      collection === 'shows' ? { title: 'Гости' } : { title: 'Дом актёра' },
    )
    const result = await setPerformanceTitle({
      data: { startsAt: '2027-03-15T14:00:00.000Z' },
      originalDoc: { show: { id: 3 }, venue: 7 },
      req: { payload: { findByID } },
    } as never)
    expect(result).toMatchObject({ title: 'Гости · 15 марта 19:00 · Дом актёра' })
    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'shows', id: 3, draft: true, overrideAccess: true }),
    )
    expect(findByID).toHaveBeenCalledWith(expect.objectContaining({ collection: 'venues', id: 7 }))
  })
})

describe('пересборка названий показов при переименовании', () => {
  it('решение: только если название реально изменилось', () => {
    expect(titleChanged({ title: 'Гости' }, { title: 'Гости' })).toBe(false)
    expect(titleChanged({ title: 'Гости' }, { title: 'Гости на ужин' })).toBe(true)
    expect(titleChanged(undefined, { title: 'Гости' })).toBe(false)
  })

  it('хук не ходит в базу без изменения названия и снимает флаг после обновления', async () => {
    const find = vi.fn(async () => ({ docs: [{ id: 5, title: 'x', _status: 'draft' }] }))
    const update = vi.fn(async () => ({}))
    const req = { payload: { find, update }, context: {} }
    const hook = refreshPerformanceTitles('show')
    await hook({
      doc: { id: 1, title: 'A' },
      previousDoc: { title: 'A' },
      operation: 'update',
      req,
    } as never)
    expect(find).not.toHaveBeenCalled()
    await hook({
      doc: { id: 1, title: 'B' },
      previousDoc: { title: 'A' },
      operation: 'update',
      req,
    } as never)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 5, draft: true }))
    expect(req.context).toEqual({})
  })
})
