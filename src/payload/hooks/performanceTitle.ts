import type { CollectionAfterChangeHook, CollectionBeforeChangeHook } from 'payload'

import { THEATRE_TIME_ZONE } from '@/modules/shows'

const dayMonthTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: THEATRE_TIME_ZONE,
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** «15 марта 19:00» — день, месяц словом (в родительном падеже) и время театра. */
export function formatPerformanceMoment(startsAt: string | Date): string {
  const parts = Object.fromEntries(
    dayMonthTime.formatToParts(new Date(startsAt)).map((p) => [p.type, p.value]),
  )
  return `${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`
}

/** «<Спектакль> · <д месяц ЧЧ:ММ> · <Площадка>»; части, которых нет, пропускаются. */
export function buildPerformanceTitle(parts: {
  showTitle?: string | null
  startsAt?: string | Date | null
  venueTitle?: string | null
}): string {
  return [
    parts.showTitle,
    parts.startsAt ? formatPerformanceMoment(parts.startsAt) : null,
    parts.venueTitle,
  ]
    .filter(Boolean)
    .join(' · ')
}

const relationId = (value: unknown): number | string | null =>
  value && typeof value === 'object'
    ? ((value as { id?: number | string }).id ?? null)
    : ((value as number | string | null) ?? null)

/** Название показа пересобирается при каждом сохранении из спектакля, даты и площадки. */
export const setPerformanceTitle: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const merged = { ...originalDoc, ...data }
  const showId = relationId(merged.show)
  const venueId = relationId(merged.venue)
  const [show, venue] = await Promise.all([
    showId
      ? req.payload.findByID({
          collection: 'shows',
          id: showId,
          depth: 0,
          draft: true,
          overrideAccess: true,
          req,
        })
      : null,
    venueId
      ? req.payload.findByID({
          collection: 'venues',
          id: venueId,
          depth: 0,
          draft: true,
          overrideAccess: true,
          req,
        })
      : null,
  ])
  return {
    ...data,
    title: buildPerformanceTitle({
      showTitle: show?.title,
      startsAt: merged.startsAt as string | undefined,
      venueTitle: venue?.title,
    }),
  }
}

/** Ключ `req.context`: пересборка названий не трогает продажи (хуки синхронизации пропускают). */
export const TITLE_REFRESH_CONTEXT = 'performanceTitle.refresh'

/** Названия показов пересобираются, только если название спектакля/площадки реально изменилось. */
export const titleChanged = (
  previous: { title?: string | null } | null | undefined,
  next: { title?: string | null } | null | undefined,
): boolean => !!previous && !!next && (previous.title ?? '') !== (next.title ?? '')

/**
 * После переименования спектакля/площадки обновляет сохранённое название их показов: оно
 * собирается только в `beforeChange` показа. Обновление идёт тем же `req` (одна транзакция),
 * последняя версия — черновик или основной документ.
 */
export const refreshPerformanceTitles =
  (relation: 'show' | 'venue'): CollectionAfterChangeHook =>
  async ({ doc, previousDoc, operation, req }) => {
    if (operation !== 'update' || !titleChanged(previousDoc, doc)) return doc
    const { payload } = req
    const performances = await payload.find({
      collection: 'performances',
      where: { [relation]: { equals: doc.id } },
      draft: true,
      depth: 0,
      pagination: false,
      overrideAccess: true,
      req,
    })
    const hadFlag = req.context?.[TITLE_REFRESH_CONTEXT]
    req.context = { ...req.context, [TITLE_REFRESH_CONTEXT]: true }
    try {
      for (const perf of performances.docs) {
        // `title` пересоберёт beforeChange показа из актуальных спектакля и площадки.
        await payload.update({
          collection: 'performances',
          id: perf.id,
          data: { title: perf.title },
          draft: perf._status === 'draft',
          depth: 0,
          overrideAccess: true,
          req,
        })
      }
    } finally {
      if (hadFlag) req.context[TITLE_REFRESH_CONTEXT] = hadFlag
      else delete req.context[TITLE_REFRESH_CONTEXT]
    }
    return doc
  }
