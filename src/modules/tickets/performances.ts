import type { ShowsData } from '@/modules/shows/types'

/**
 * Что билет знает о показе: спектакль, время, площадка. В билете хранится только `performance_id`
 * (ядро продаж не копирует контент CMS), поэтому данные показа берутся из источника афиши.
 * Прошедшие показы тоже ищутся — для вкладки «Прошедшие».
 */
export type PerformanceInfo = {
  showTitle: string
  showSlug: string
  /** ISO 8601 со смещением театра. */
  startsAt: string
  durationMinutes: number | null
  venue: { title: string; address: string } | null
}

export type PerformanceLookup = (performanceId: string) => PerformanceInfo | null

/** Длительность по умолчанию для «прошёл ли показ» и календаря, если театр её не указал. */
export const DEFAULT_DURATION_MINUTES = 180

export const performanceLookupFrom = (data: ShowsData): PerformanceLookup => {
  const shows = new Map(data.shows.map((s) => [s.slug, s]))
  const venues = new Map(data.venues.map((v) => [v.id, v]))
  const performances = new Map(data.performances.map((p) => [p.id, p]))
  return (id) => {
    const p = performances.get(id)
    const show = p && shows.get(p.showSlug)
    if (!p || !show) return null
    const venue = venues.get(p.venueId)
    return {
      showTitle: show.title,
      showSlug: show.slug,
      startsAt: p.startsAt,
      durationMinutes: show.durationMinutes,
      venue: venue ? { title: venue.title, address: venue.address } : null,
    }
  }
}

/** «Ряд 3, место 12» из id места схемы зала (`r<ряд>-s<место>`); иной формат — как есть. */
export const seatLabel = (seatId: string | null) => {
  if (!seatId) return null
  const m = /^r(\d+)-s(\d+)$/.exec(seatId)
  return m ? `Ряд ${m[1]}, место ${m[2]}` : seatId
}

/** Окончание показа: начало + длительность (или значение по умолчанию). */
export const performanceEnd = (info: Pick<PerformanceInfo, 'startsAt' | 'durationMinutes'>) =>
  new Date(
    new Date(info.startsAt).getTime() + (info.durationMinutes ?? DEFAULT_DURATION_MINUTES) * 60_000,
  )

/** Снимок показа из позиции заказа (`commerce_order_items.*_snapshot`). */
export type ShowSnapshot = {
  showTitle: string
  showSlug: string
  startsAt: Date
  venue: { title: string; address: string } | null
}

/** Снимок из колонок позиции; неполный (позиции до снимков) — null. */
export const snapshotFromColumns = (c: {
  showTitleSnapshot: string | null
  showSlugSnapshot: string | null
  startsAtSnapshot: Date | null
  venueTitleSnapshot: string | null
  venueAddressSnapshot: string | null
}): ShowSnapshot | null =>
  c.showTitleSnapshot && c.startsAtSnapshot
    ? {
        showTitle: c.showTitleSnapshot,
        showSlug: c.showSlugSnapshot ?? '',
        startsAt: c.startsAtSnapshot,
        venue:
          c.venueTitleSnapshot !== null
            ? { title: c.venueTitleSnapshot, address: c.venueAddressSnapshot ?? '' }
            : null,
      }
    : null

/**
 * Данные показа для билета: сначала снимок на момент покупки (не зависит от CMS, демо-данных
 * и доступности Payload — так работает worker), длительность — из афиши, если она доступна.
 * Снимка нет (старые заказы) — из афиши.
 */
export const performanceInfoFor = (
  performanceId: string,
  snapshot: ShowSnapshot | null,
  lookup: PerformanceLookup,
): PerformanceInfo | null => {
  const live = lookup(performanceId)
  if (!snapshot) return live
  return {
    showTitle: snapshot.showTitle,
    showSlug: snapshot.showSlug || live?.showSlug || '',
    startsAt: snapshot.startsAt.toISOString(),
    durationMinutes: live?.durationMinutes ?? null,
    venue: snapshot.venue,
  }
}

/** Источник афиши недоступен (worker без Payload) — только снимки. */
export const noPerformanceLookup: PerformanceLookup = () => null
