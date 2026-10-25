import type {
  Archive as CmsArchive,
  Media as CmsMedia,
  Performance as CmsPerformance,
  Person as CmsPerson,
  Show as CmsShow,
  TicketType as CmsTicketType,
  Venue as CmsVenue,
} from '@/payload-types'

import type { ArchivedShow, Credit, Performance, Show, ShowsData, TicketType, Venue } from './types'

/**
 * Документы Payload → read model афиши (те же типы, что у демо-набора). Чистые функции:
 * запросы к CMS — в @/modules/site-data. На вход — только опубликованное (draft: false и
 * доступ `publishedOrStaff`); связи на неопубликованные записи приходят id и отбрасываются.
 */

type Ref<T> = number | T | null | undefined

const obj = <T>(ref: Ref<T>): T | null => (ref && typeof ref === 'object' ? ref : null)

export const mediaUrl = (ref: Ref<CmsMedia>) => obj(ref)?.url ?? undefined

/** Файл из «Медиа», иначе временный адрес со старого сайта. */
export const imageOf = (media: Ref<CmsMedia>, legacyUrl: string | null | undefined) =>
  mediaUrl(media) ?? (legacyUrl || undefined)

/** Абзацы: разделитель — пустая строка. */
export const paragraphs = (text: string | null | undefined): string[] =>
  (text ?? '')
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)

const focusOf = (media: Ref<CmsMedia>) => {
  const m = obj(media)
  return typeof m?.focalX === 'number' && typeof m.focalY === 'number'
    ? `${m.focalX}% ${m.focalY}%`
    : undefined
}

type CmsCredits = CmsShow['credits']

export const creditsOf = (credits: CmsCredits): Credit[] =>
  (credits ?? [])
    .map((c) => ({
      role: c.role,
      entries: (c.entries ?? [])
        .map((e) => ({
          ...(e.character ? { character: e.character } : {}),
          people: (e.people ?? [])
            .map((p) => obj<CmsPerson>(p)?.name)
            .filter((n): n is string => !!n),
        }))
        .filter((e) => e.people.length > 0),
    }))
    .filter((c) => c.entries.length > 0)

const dateOnly = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : undefined)

/** UTC из CMS → ISO со смещением театра (Екатеринбург, UTC+5 без перехода на летнее время). */
export const THEATRE_OFFSET = '+05:00'
export const toTheatreIso = (utc: string) => {
  const local = new Date(new Date(utc).getTime() + 5 * 3_600_000).toISOString()
  return `${local.slice(0, 19)}${THEATRE_OFFSET}`
}

export const showFromCms = (doc: CmsShow): Show | null => {
  const gallery = (doc.gallery ?? [])
    .map((g) => imageOf(g.image, g.imageUrl))
    .filter((u): u is string => !!u)
  const posterUrl = imageOf(doc.poster, doc.posterUrl) ?? imageOf(doc.cover, doc.coverUrl)
  if (!doc.slug || !posterUrl) return null
  const coverUrl = imageOf(doc.cover, doc.coverUrl)
  const previewUrl = imageOf(doc.preview, doc.previewUrl)
  const coverFocus = doc.coverFocus || focusOf(doc.cover)
  const seoImage = mediaUrl(doc.seo?.image)
  return {
    slug: doc.slug,
    title: doc.title,
    genre: doc.genre ?? null,
    ageLimit: doc.ageLimit ?? null,
    durationMinutes: doc.durationMinutes ?? null,
    lead: doc.lead,
    description: paragraphs(doc.description),
    credits: creditsOf(doc.credits),
    eventType: doc.eventType,
    ...(doc.premiere && { premiere: true }),
    announcedAt: dateOnly(doc.announcedAt) ?? dateOnly(doc.createdAt),
    ...(doc.pushkinCard && { pushkinCard: true }),
    ...(doc.studentOffer && { studentOffer: true }),
    gallery,
    posterUrl,
    ...(coverUrl && { coverUrl }),
    ...(coverFocus && { coverFocus }),
    ...(previewUrl && { previewUrl }),
    ...((doc.seo?.title || doc.seo?.description || seoImage) && {
      seo: {
        ...(doc.seo?.title && { title: doc.seo.title }),
        ...(doc.seo?.description && { description: doc.seo.description }),
        ...(seoImage && { imageUrl: seoImage }),
      },
    }),
    status: 'published',
  }
}

export const venueFromCms = (doc: CmsVenue): Venue => ({
  id: doc.code,
  title: doc.title,
  address: doc.address,
  kind: doc.kind,
})

export const ticketTypeFromCms = (doc: CmsTicketType): TicketType => ({
  id: doc.code,
  title: doc.title,
  priceKopecks: doc.priceKopecks,
  capacity: doc.capacity,
  ...(doc.placeholder && { placeholder: true }),
})

export const performanceFromCms = (
  doc: CmsPerformance,
  ticketTypes: CmsTicketType[],
): Performance | null => {
  const show = obj<CmsShow>(doc.show)
  const venue = obj<CmsVenue>(doc.venue)
  if (!doc.code || !show?.slug || !venue) return null
  const seating = doc.seating?.planId
    ? {
        planId: doc.seating.planId,
        pricesKopecks: Object.fromEntries(
          (doc.seating.prices ?? []).map((p) => [p.categoryId, p.priceKopecks]),
        ),
        ...(doc.seating.pricesPlaceholder && { pricesPlaceholder: true }),
        unavailableSeatIds: doc.seating.unavailableSeatIds ?? [],
      }
    : undefined
  return {
    id: doc.code,
    showSlug: show.slug,
    venueId: venue.code,
    startsAt: toTheatreIso(doc.startsAt),
    ticketTypes: ticketTypes.map(ticketTypeFromCms),
    ...(seating && { seating }),
    ...(doc.salesStartAt && { salesStartsAt: toTheatreIso(doc.salesStartAt) }),
    ...(doc.salesEndAt && { salesEndsAt: toTheatreIso(doc.salesEndAt) }),
  }
}

export const archivedFromCms = (doc: CmsArchive): ArchivedShow | null => {
  const posterUrl = imageOf(doc.poster, doc.posterUrl)
  if (!doc.slug || !posterUrl) return null
  return {
    slug: doc.slug,
    title: doc.title,
    genre: doc.genre ?? null,
    posterUrl,
    credits: creditsOf(doc.credits),
  }
}

export type CmsShowsDocs = {
  shows: CmsShow[]
  venues: CmsVenue[]
  performances: CmsPerformance[]
  ticketTypes: CmsTicketType[]
  archive: CmsArchive[]
}

const performanceId = (t: CmsTicketType) =>
  typeof t.performance === 'object' ? t.performance?.id : t.performance

/** Собирает ShowsData: показы — только опубликованных спектаклей на опубликованных площадках. */
export const showsDataFromCms = (docs: CmsShowsDocs): ShowsData => {
  const shows = docs.shows.map(showFromCms).filter((s): s is Show => s !== null)
  const venues = docs.venues.map(venueFromCms)
  const typesBy = new Map<number, CmsTicketType[]>()
  for (const t of [...docs.ticketTypes].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    const id = performanceId(t)
    if (typeof id === 'number') typesBy.set(id, [...(typesBy.get(id) ?? []), t])
  }
  const performances = docs.performances
    .map((p) => performanceFromCms(p, typesBy.get(p.id) ?? []))
    .filter((p): p is Performance => p !== null)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  const archive = docs.archive.map(archivedFromCms).filter((a): a is ArchivedShow => a !== null)
  return { venues, shows, performances, archive }
}
