import { formatTheatreDateTime } from './format'
import { performanceSalesState, type SalesPerformance, type SalesTicketType } from './salesState'

/**
 * Готовность показа к продаже: чего не хватает, чтобы на сайте появилась кнопка «Купить».
 * Цены, окно продаж и «показ уже начался» — из `performanceSalesState` (те же правила, что у
 * сайта); сверху — публикация спектакля и площадки (черновик на сайте не виден).
 */

/** `null` — статус ещё не загружен или не определён (нет выбранного спектакля/площадки). */
export type PublishStatus = 'published' | 'draft' | null

export type ReadinessInput = {
  performance: SalesPerformance
  ticketTypes: readonly SalesTicketType[]
  showStatus: PublishStatus
  venueStatus: PublishStatus
  now: Date
}

export type ReadinessItemId = 'show' | 'venue' | 'date' | 'prices' | 'window'

/** ok — выполнено; fail — продажи не откроются; warn — стоит проверить, но не блокирует. */
export type ReadinessItem = {
  id: ReadinessItemId
  state: 'ok' | 'fail' | 'warn'
  label: string
  hint?: string
  /** Для итоговой строки «Продажи не откроются: …» (только у fail). */
  reason?: string
}

export type Readiness = {
  items: ReadinessItem[]
  ready: boolean
  /** Короткие причины, по которым продажи не откроются. */
  problems: string[]
}

const publishItem = (
  id: 'show' | 'venue',
  status: PublishStatus,
  noun: string,
  label: string,
  reason: string,
): ReadinessItem => {
  if (status === 'published') return { id, state: 'ok', label }
  if (status === 'draft')
    return {
      id,
      state: 'fail',
      label,
      reason,
      hint: `${noun} в черновике — опубликуйте его, иначе показ не появится на сайте.`,
    }
  return { id, state: 'fail', label, reason, hint: `Выберите ${noun.toLowerCase()} в показе.` }
}

export function performanceReadiness(input: ReadinessInput): Readiness {
  const { performance, ticketTypes, showStatus, venueStatus, now } = input
  const sales = performanceSalesState(performance, ticketTypes, now)
  const noDate = !performance.startsAt

  const items: ReadinessItem[] = [
    publishItem(
      'show',
      showStatus,
      'Спектакль',
      'Спектакль опубликован',
      'спектакль не опубликован',
    ),
    publishItem(
      'venue',
      venueStatus,
      'Площадка',
      'Площадка опубликована',
      'площадка не опубликована',
    ),
    noDate
      ? {
          id: 'date',
          state: 'fail',
          label: 'Дата в будущем',
          reason: 'не указана дата',
          hint: 'Укажите начало показа.',
        }
      : sales.isPast
        ? {
            id: 'date',
            state: 'fail',
            label: 'Дата в будущем',
            reason: 'показ уже начался',
            hint: 'Показ уже начался — измените дату начала.',
          }
        : { id: 'date', state: 'ok', label: 'Дата в будущем' },
    sales.hasPrices
      ? { id: 'prices', state: 'ok', label: 'Есть цены' }
      : {
          id: 'prices',
          state: 'fail',
          label: 'Есть цены',
          reason: 'нет цен',
          hint: 'Назначьте цену хотя бы одной зоне схемы зала или добавьте категорию билетов.',
        },
    windowItem(performance, sales.window),
  ]

  const problems = failedReasons(items)
  return { items, ready: problems.length === 0, problems }
}

const windowItem = (
  performance: SalesPerformance,
  window: ReturnType<typeof performanceSalesState>['window'],
): ReadinessItem => {
  const label = 'Окно продаж'
  if (window.state === 'ended')
    return {
      id: 'window',
      state: 'fail',
      label,
      reason: 'окно продаж закрыто',
      hint: 'Время «Продажи до» уже прошло — измените или очистите его.',
    }
  if (window.state === 'notYet')
    return {
      id: 'window',
      state: 'ok',
      label,
      hint: `Продажи откроются ${formatTheatreDateTime(window.opensAt, { weekday: false })}.`,
    }
  if (!performance.salesStartAt)
    return {
      id: 'window',
      state: 'warn',
      label,
      hint: '«Продажи с» пусто — продажи откроются сразу при публикации. Задайте дату, если нужно позже.',
    }
  return { id: 'window', state: 'ok', label }
}

const failedReasons = (items: readonly ReadinessItem[]) =>
  items.flatMap((i) => (i.state === 'fail' && i.reason ? [i.reason] : []))
