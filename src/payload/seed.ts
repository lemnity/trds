import { existsSync } from 'node:fs'
import path from 'node:path'

import type { Payload } from 'payload'

import { demoSiteContent, school, type SiteContent } from '@/modules/content'
import { personSlug } from '@/modules/people'
import { demoShowsData, type Credit, type ShowsData } from '@/modules/shows'

/**
 * Перенос демо-набора (реальные данные с teatrturdus.ru) в пустую CMS — `pnpm cms:seed`.
 * Идемпотентно: записи ищутся по стабильному ключу (адрес, код показа/площадки, ключ категории)
 * и обновляются, повторный запуск ничего не дублирует. Картинки со старого сайта остаются
 * ссылками (поле «адрес на старом сайте», до переноса медиа T-024); локальные файлы —
 * портреты src/assets/people и афиши public/posters — загружаются в «Медиа».
 */

type Log = (line: string) => void
type Id = number

export type SeedOptions = {
  root: string
  shows?: ShowsData
  content?: SiteContent
  log?: Log
}

export type SeedReport = Record<string, { created: number; updated: number }>

const PUBLISHED = { _status: 'published' as const }

/** Все имена из составов — у каждого будет запись «Люди». */
export const creditedNames = (data: ShowsData): string[] => {
  const names = new Map<string, string>()
  const add = (credits: Credit[]) => {
    for (const c of credits)
      for (const e of c.entries) for (const n of e.people) names.set(personSlug(n), n)
  }
  for (const s of data.shows) add(s.credits)
  for (const a of data.archive ?? []) add(a.credits)
  return [...names.values()]
}

/** «Без сдвига» UTC: дата из демо-набора уже со смещением театра. */
const utc = (iso: string) => new Date(iso).toISOString()

/** Локальный файл из public/ (путь вида /posters/x.webp, возможно с basePath). */
const publicFile = (root: string, url: string | undefined) => {
  if (!url || /^https?:\/\//.test(url)) return null
  const rel = url.replace(/^\/[^/]+(?=\/posters\/)/, '')
  const file = path.join(root, 'public', rel)
  return existsSync(file) ? file : null
}

export async function seedCms(payload: Payload, options: SeedOptions): Promise<SeedReport> {
  const { root, log = () => {} } = options
  const shows = options.shows ?? demoShowsData
  const content = options.content ?? demoSiteContent
  const report: SeedReport = {}
  const count = (collection: string, created: boolean) => {
    const r = (report[collection] ??= { created: 0, updated: 0 })
    if (created) r.created++
    else r.updated++
  }

  /** Создать или обновить по ключу; черновик создаётся черновиком. */
  async function upsert(
    collection: Parameters<Payload['find']>[0]['collection'],
    where: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<Id> {
    const found = await payload.find({
      collection,
      where: where as never,
      limit: 1,
      depth: 0,
      draft: true,
      overrideAccess: true,
    })
    const draft = data._status === 'draft'
    const existing = found.docs[0] as { id: Id } | undefined
    if (existing) {
      await payload.update({
        collection,
        id: existing.id,
        data: data as never,
        draft,
        overrideAccess: true,
      })
      count(collection, false)
      return existing.id
    }
    const doc = (await payload.create({
      collection,
      data: data as never,
      draft,
      overrideAccess: true,
    })) as { id: Id }
    count(collection, true)
    return doc.id
  }

  const mediaCache = new Map<string, Id>()
  /** Загрузить файл в «Медиа» один раз (повторно — найти по имени файла). */
  async function media(file: string, alt: string): Promise<Id> {
    const filename = path.basename(file)
    const cached = mediaCache.get(filename)
    if (cached) return cached
    const found = await payload.find({
      collection: 'media',
      // Файл с тем же именем уже лежал на диске — Payload сохранил его как «имя-1.jpg».
      where: {
        or: [
          { filename: { equals: filename } },
          {
            and: [{ alt: { equals: alt } }, { filename: { like: path.parse(filename).name } }],
          },
        ],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    let id = found.docs[0]?.id
    if (id) count('media', false)
    else {
      id = (
        await payload.create({
          collection: 'media',
          data: { alt },
          filePath: file,
          overrideAccess: true,
        })
      ).id
      count('media', true)
    }
    mediaCache.set(filename, id)
    return id
  }

  /** Поле картинки: файл, если он локальный, иначе адрес старого сайта. */
  const image = async (name: string, url: string | undefined, alt: string) => {
    if (!url) return { [name]: null, [`${name}Url`]: null }
    const file = publicFile(root, url)
    return file
      ? { [name]: await media(file, alt), [`${name}Url`]: null }
      : { [name]: null, [`${name}Url`]: url }
  }

  // --- Площадки ---
  const venueIds = new Map<string, Id>()
  for (const [i, v] of shows.venues.entries())
    venueIds.set(
      v.id,
      await upsert(
        'venues',
        { code: { equals: v.id } },
        {
          code: v.id,
          title: v.title,
          address: v.address,
          kind: v.kind,
          sortOrder: i,
          ...PUBLISHED,
        },
      ),
    )
  log(`venues: ${venueIds.size}`)

  // --- Люди: все из составов, руководство и педагоги школы; портреты из src/assets/people ---
  const leaders = new Map(content.leadership.map((l, i) => [personSlug(l.name), { ...l, i }]))
  const names = [
    ...new Set([
      ...creditedNames(shows),
      ...content.leadership.map((l) => l.name),
      ...school.teachers.map((t) => t.name),
    ]),
  ]
  const personIds = new Map<string, Id>()
  for (const name of names) {
    const slug = personSlug(name)
    const bio = content.personBios[slug]
    const leader = leaders.get(slug)
    const portraitFile = path.join(root, 'src/assets/people', `${slug}.jpg`)
    const portrait = existsSync(portraitFile) ? await media(portraitFile, name) : null
    personIds.set(
      slug,
      await upsert(
        'people',
        { slug: { equals: slug } },
        {
          name,
          slug,
          portrait,
          position: leader?.position ?? null,
          bioTitle: bio?.title ?? null,
          bio: bio?.paragraphs.join('\n\n') ?? null,
          works: (bio?.works ?? []).map((title) => ({ title })),
          quote: leader?.quote ? { text: leader.quote.text, about: leader.quote.about } : {},
          leadership: !!leader,
          sortOrder: leader?.i ?? 0,
          source: bio?.source ?? leader?.source ?? null,
          ...PUBLISHED,
        },
      ),
    )
  }
  log(`people: ${personIds.size}`)

  const credits = (list: Credit[]) =>
    list.map((c) => ({
      role: c.role,
      entries: c.entries.map((e) => ({
        character: e.character ?? null,
        people: e.people.map((n) => personIds.get(personSlug(n))!),
      })),
    }))

  // --- Спектакли ---
  const showIds = new Map<string, Id>()
  for (const s of shows.shows) {
    const gallery = []
    for (const url of s.gallery) {
      const img = await image('image', url, `Сцена из спектакля «${s.title}»`)
      gallery.push(img)
    }
    showIds.set(
      s.slug,
      await upsert(
        'shows',
        { slug: { equals: s.slug } },
        {
          slug: s.slug,
          title: s.title,
          eventType: s.eventType,
          genre: s.genre,
          ageLimit: s.ageLimit,
          durationMinutes: s.durationMinutes,
          premiere: s.premiere === true,
          pushkinCard: s.pushkinCard === true,
          studentOffer: s.studentOffer === true,
          announcedAt: s.announcedAt ? `${s.announcedAt}T00:00:00.000Z` : null,
          lead: s.lead,
          description: s.description.join('\n\n'),
          credits: credits(s.credits),
          ...(await image('poster', s.posterUrl, `Афиша спектакля «${s.title}»`)),
          ...(await image('cover', s.coverUrl, `Обложка спектакля «${s.title}»`)),
          coverFocus: s.coverFocus ?? null,
          ...(await image('preview', s.previewUrl, `Спектакль «${s.title}»`)),
          gallery,
          _status: s.status,
        },
      ),
    )
  }
  log(`shows: ${showIds.size}`)

  // --- Показы и категории билетов (квоты уходят в inventory через хук syncCapacity) ---
  for (const p of shows.performances) {
    const showId = showIds.get(p.showSlug)
    const venueId = venueIds.get(p.venueId)
    if (!showId || !venueId) continue
    const performanceId = await upsert(
      'performances',
      { code: { equals: p.id } },
      {
        code: p.id,
        show: showId,
        venue: venueId,
        startsAt: utc(p.startsAt),
        seating: p.seating
          ? {
              planId: p.seating.planId,
              prices: Object.entries(p.seating.pricesKopecks).map(([categoryId, priceKopecks]) => ({
                categoryId,
                priceKopecks,
              })),
              pricesPlaceholder: p.seating.pricesPlaceholder === true,
              unavailableSeatIds: p.seating.unavailableSeatIds,
            }
          : { planId: null, prices: [], pricesPlaceholder: false, unavailableSeatIds: [] },
        ...PUBLISHED,
      },
    )
    for (const [i, t] of p.ticketTypes.entries())
      await upsert(
        'ticket-types',
        { and: [{ performance: { equals: performanceId } }, { code: { equals: t.id } }] },
        {
          performance: performanceId,
          code: t.id,
          title: t.title,
          priceKopecks: t.priceKopecks,
          capacity: t.capacity,
          placeholder: t.placeholder === true,
          sortOrder: i,
        },
      )
  }
  log(`performances: ${shows.performances.length}`)

  // --- Архив ---
  for (const [i, a] of (shows.archive ?? []).entries())
    await upsert(
      'archive',
      { slug: { equals: a.slug } },
      {
        slug: a.slug,
        title: a.title,
        genre: a.genre,
        ...(await image('poster', a.posterUrl, `Афиша постановки «${a.title}»`)),
        credits: credits(a.credits),
        sortOrder: i,
        ...PUBLISHED,
      },
    )

  // --- Новости: порядок демо-набора — от новой к старой ---
  const today = Date.UTC(2026, 9, 24)
  for (const [i, n] of content.news.entries())
    await upsert(
      'news',
      { slug: { equals: n.id } },
      {
        slug: n.id,
        title: n.title,
        tag: n.tag,
        summary: n.summary,
        href: n.href,
        ...(await image('cover', n.imageUrl, n.title)),
        publishedAt: new Date(today - i * 86_400_000).toISOString(),
        ...PUBLISHED,
      },
    )

  for (const [i, r] of content.reviews.entries())
    await upsert(
      'reviews',
      { slug: { equals: r.id } },
      {
        slug: r.id,
        author: r.author,
        role: r.role,
        lead: r.lead,
        quote: r.quote,
        sortOrder: i,
        ...PUBLISHED,
      },
    )

  for (const [i, p] of content.partners.entries())
    await upsert('partners', { name: { equals: p.name } }, { ...p, sortOrder: i, ...PUBLISHED })

  // Документы — заглушки без текста: тексты передаёт театр (T-001/T-002).
  for (const [i, d] of content.legalDocuments.entries())
    await upsert(
      'documents',
      { slug: { equals: d.slug } },
      { slug: d.slug, title: d.title, sortOrder: i, ...PUBLISHED },
    )

  const photos = (urls: string[], alt: string) =>
    Promise.all(urls.map((url) => image('image', url, alt)))
  await upsert(
    'pages',
    { slug: { equals: 'about' } },
    {
      slug: 'about',
      title: content.aboutTheatre.title,
      lead: content.aboutTheatre.lead,
      body: content.aboutTheatre.paragraphs.join('\n\n'),
      photos: await photos(content.aboutTheatre.photos, 'Модный театр TURDUS'),
      ...PUBLISHED,
    },
  )
  await upsert(
    'pages',
    { slug: { equals: 'corporate' } },
    {
      slug: 'corporate',
      title: content.corporate.title,
      lead: content.corporate.slogan,
      body: content.corporate.paragraphs.join('\n\n'),
      photos: await photos(content.corporate.photos, 'Корпоратив с театром TURDUS'),
      ...PUBLISHED,
    },
  )

  const c = content.contacts
  await payload.updateGlobal({
    slug: 'site-settings',
    data: {
      theatreName: 'Модный театр TURDUS',
      slogan: content.aboutTheatre.lead,
      contacts: {
        phone: c.phone.display,
        email: c.email,
        officeAddress: c.office.address,
        officeShort: c.office.short,
        hours: c.office.hours,
        mapUrl: c.office.mapUrl,
      },
      social: c.social,
    },
    overrideAccess: true,
  })
  count('site-settings', false)
  return report
}
