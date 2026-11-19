import type { CollectionBeforeChangeHook } from 'payload'

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
