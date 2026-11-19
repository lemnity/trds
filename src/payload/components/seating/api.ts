import type { SeatPricing } from '@/modules/seating'

/**
 * Шаблоны цен зала через REST Payload (сессия админки в cookie). Права проверяет сама
 * коллекция «Шаблоны цен зала»: читать — сотрудник, менять — администратор театра.
 */

export const SEAT_TEMPLATES_SLUG = 'seat-price-templates'

export type SeatTemplate = {
  id: number | string
  title: string
  planId: string
  venue: number | string | { id: number | string } | null
  pricing: SeatPricing | null
}

type Id = number | string

const call = async <T>(apiUrl: string, path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${apiUrl}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const body = (await res.json().catch(() => null)) as
    (T & { errors?: { message?: string; data?: { errors?: { message?: string }[] } }[] }) | null
  if (!res.ok) {
    const err = body?.errors?.[0]
    throw new Error(err?.data?.errors?.[0]?.message ?? err?.message ?? `Ошибка ${res.status}`)
  }
  return body as T
}

/** Схема зала площадки (поле «Схема зала» у площадки). */
export const fetchVenuePlanId = async (apiUrl: string, venueId: Id): Promise<string | null> => {
  const venue = await call<{ seatingPlanId?: string | null }>(
    apiUrl,
    `/venues/${venueId}?depth=0&draft=true`,
  )
  return venue.seatingPlanId ?? null
}

export const listTemplates = async (
  apiUrl: string,
  where: { planId?: string; venue?: Id },
): Promise<SeatTemplate[]> => {
  const q = new URLSearchParams({ depth: '0', limit: '100', sort: 'title' })
  if (where.planId) q.set('where[planId][equals]', where.planId)
  if (where.venue !== undefined) q.set('where[venue][equals]', String(where.venue))
  return (await call<{ docs: SeatTemplate[] }>(apiUrl, `/${SEAT_TEMPLATES_SLUG}?${q}`)).docs
}

export const createTemplate = (
  apiUrl: string,
  data: { title: string; venue: Id; planId: string; pricing: SeatPricing },
) =>
  call<{ doc: SeatTemplate }>(apiUrl, `/${SEAT_TEMPLATES_SLUG}?depth=0`, {
    method: 'POST',
    body: JSON.stringify(data),
  }).then((r) => r.doc)

export const updateTemplate = (
  apiUrl: string,
  id: Id,
  data: Partial<Pick<SeatTemplate, 'title' | 'pricing' | 'planId'>>,
) =>
  call<{ doc: SeatTemplate }>(apiUrl, `/${SEAT_TEMPLATES_SLUG}/${id}?depth=0`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }).then((r) => r.doc)

export const deleteTemplate = (apiUrl: string, id: Id) =>
  call<unknown>(apiUrl, `/${SEAT_TEMPLATES_SLUG}/${id}`, { method: 'DELETE' })
