import { MAX_TICKETS_PER_ORDER } from './quote'

/** Выбор зрителя для страницы оформления. Цены не передаются — их пересчитывает сервер/домен. */
export type Selection =
  { kind: 'tickets'; quantities: Record<string, number> } | { kind: 'seats'; seatIds: string[] }

const ID = /^[a-z0-9-]+$/
const QUANTITY = /^[1-9]\d?$/

export const selectionToSearch = (selection: Selection): string => {
  const params = new URLSearchParams()
  if (selection.kind === 'tickets') {
    const value = Object.entries(selection.quantities)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => `${id}:${q}`)
      .join(',')
    params.set('tickets', value)
  } else {
    params.set('seats', selection.seatIds.join(','))
  }
  return params.toString()
}

/** Разбор строго по формату; всё подозрительное — null, а не «примерная» догадка. */
export const selectionFromSearch = (params: URLSearchParams): Selection | null => {
  const tickets = params.get('tickets')
  const seats = params.get('seats')
  if ((tickets === null) === (seats === null)) return null

  if (tickets !== null) {
    const quantities: Record<string, number> = {}
    for (const part of tickets.split(',')) {
      const [id, qty, extra] = part.split(':')
      if (extra !== undefined || !id || !qty || !ID.test(id) || !QUANTITY.test(qty)) return null
      const n = Number(qty)
      if (n > MAX_TICKETS_PER_ORDER || id in quantities) return null
      quantities[id] = n
    }
    return { kind: 'tickets', quantities }
  }

  const seatIds = seats!.split(',')
  if (seatIds.some((id) => !ID.test(id))) return null
  return { kind: 'seats', seatIds }
}
