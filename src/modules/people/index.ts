import type { Credit, ShowsData } from '@/modules/shows'

export type Person = { slug: string; name: string }

export type PersonWork = {
  show: { slug: string; title: string }
  role: string
  character: string | null
  /** Ближайший будущий показ спектакля, если есть. */
  nextStartsAt: string | null
}

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
}

/** Адрес страницы человека. «ё» = «е»: «Артём Аксёнов» и «Артем Аксенов» — один человек. */
export const personSlug = (name: string): string =>
  [...name.toLowerCase()]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const publishedShows = (data: ShowsData) => data.shows.filter((s) => s.status === 'published')

/** Опубликованные спектакли и архив — у кого есть строка в составе, у того есть страница. */
const creditedShows = (data: ShowsData) => [...publishedShows(data), ...(data.archive ?? [])]

export const listPeople = (data: ShowsData): Person[] => {
  const people = new Map<string, Person>()
  for (const show of creditedShows(data))
    for (const credit of show.credits)
      for (const entry of credit.entries)
        for (const name of entry.people) {
          const slug = personSlug(name)
          if (!people.has(slug)) people.set(slug, { slug, name })
        }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

export const getPersonPage = (data: ShowsData, slug: string, now: Date) => {
  const person = listPeople(data).find((p) => p.slug === slug)
  if (!person) return null
  const works: PersonWork[] = []
  for (const show of publishedShows(data)) {
    const next = data.performances
      .filter((p) => p.showSlug === show.slug && Date.parse(p.startsAt) > now.getTime())
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0]
    for (const credit of show.credits)
      for (const entry of credit.entries)
        if (entry.people.some((n) => personSlug(n) === slug))
          works.push({
            show: { slug: show.slug, title: show.title },
            role: credit.role,
            character: entry.character ?? null,
            nextStartsAt: next?.startsAt ?? null,
          })
  }
  return { person, works }
}

/** Направление работы по названию строки в составе («Режиссер, продюсер» → два направления). */
const FIELDS: [RegExp, string][] = [
  [/в ролях|действующие лица|хозяин|ведущ/i, 'Актёрские работы'],
  [/режисс/i, 'Режиссура'],
  [/продюс/i, 'Продюсирование'],
  [/хореограф/i, 'Хореография'],
  [/художник/i, 'Сценография'],
  [/автор|сценарист|драматург/i, 'Драматургия'],
  [/звук|свет/i, 'Звук и свет'],
]

const creditFields = (role: string): string[] => {
  const fields = FIELDS.filter(([re]) => re.test(role)).map(([, field]) => field)
  return fields.length ? fields : [role]
}

/** Роль в спектакле: персонаж («Шанель») или строка состава («Режиссёр», «В составе»). */
export type PersonRole = { kind: 'character' | 'credit'; title: string }

export type PersonShow = {
  slug: string
  title: string
  genre: string | null
  posterUrl: string
  /** Первое фото спектакля — для вертикальной карточки (обложка горизонтальная, с надписями). */
  photoUrl: string | null
  roles: PersonRole[]
  next: { id: string; startsAt: string; venueTitle: string } | null
}

export type PersonArchiveShow = Pick<PersonShow, 'slug' | 'title' | 'genre' | 'posterUrl' | 'roles'>

export type PersonPhoto = { src: string; showSlug: string; showTitle: string }

/** Сколько фото спектаклей показать на странице человека. */
const PROFILE_PHOTOS = 24

/** Строка «В ролях» без персонажа — человек в составе, но кого играет, не указано. */
const CAST = /^(в ролях|действующие лица)$/i

const toRole = (role: string, character: string | null | undefined): PersonRole =>
  character
    ? { kind: 'character', title: character }
    : { kind: 'credit', title: CAST.test(role) ? 'В составе' : role }

const addRole = (roles: PersonRole[], role: PersonRole) => {
  if (!roles.some((r) => r.kind === role.kind && r.title === role.title)) roles.push(role)
}

/** Роли человека в составе спектакля (по всем строкам и персонажам). */
const rolesIn = (credits: Credit[], slug: string) => {
  const roles: PersonRole[] = []
  const lines: string[] = []
  for (const credit of credits)
    for (const entry of credit.entries)
      if (entry.people.some((n) => personSlug(n) === slug)) {
        addRole(roles, toRole(credit.role, entry.character))
        lines.push(credit.role)
      }
  return { roles, lines }
}

/**
 * Страница человека: направления работы, роли в идущем репертуаре с ближайшим показом,
 * архив прошедших постановок и фото из спектаклей репертуара — по очереди из каждого,
 * чтобы один спектакль не занял всю галерею. Только то, что есть в составах.
 */
export const getPersonProfile = (data: ShowsData, slug: string, now: Date) => {
  const person = listPeople(data).find((p) => p.slug === slug)
  if (!person) return null
  const venues = new Map(data.venues.map((v) => [v.id, v.title]))
  const fields: string[] = []
  const addFields = (lines: string[]) => {
    for (const line of lines)
      for (const field of creditFields(line)) if (!fields.includes(field)) fields.push(field)
  }

  const shows: PersonShow[] = []
  for (const show of publishedShows(data)) {
    const { roles, lines } = rolesIn(show.credits, slug)
    if (!roles.length) continue
    addFields(lines)
    const next = data.performances
      .filter((p) => p.showSlug === show.slug && Date.parse(p.startsAt) > now.getTime())
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0]
    shows.push({
      slug: show.slug,
      title: show.title,
      genre: show.genre,
      posterUrl: show.posterUrl,
      photoUrl: show.gallery[0] ?? null,
      roles,
      next: next
        ? { id: next.id, startsAt: next.startsAt, venueTitle: venues.get(next.venueId) ?? '' }
        : null,
    })
  }

  const archive: PersonArchiveShow[] = []
  for (const show of data.archive ?? []) {
    const { roles, lines } = rolesIn(show.credits, slug)
    if (!roles.length) continue
    addFields(lines)
    archive.push({
      slug: show.slug,
      title: show.title,
      genre: show.genre,
      posterUrl: show.posterUrl,
      roles,
    })
  }

  const galleries = shows.map((s) => ({
    show: s,
    photos: data.shows.find((x) => x.slug === s.slug)?.gallery ?? [],
  }))
  const gallery: PersonPhoto[] = []
  const seen = new Set<string>()
  for (let i = 0; gallery.length < PROFILE_PHOTOS; i++) {
    const round = galleries.filter((g) => i < g.photos.length)
    if (!round.length) break
    for (const g of round) {
      const src = g.photos[i]!
      if (seen.has(src) || gallery.length >= PROFILE_PHOTOS) continue
      seen.add(src)
      gallery.push({ src, showSlug: g.show.slug, showTitle: g.show.title })
    }
  }

  const current = new Set(shows.map((s) => s.slug))
  const upcoming = data.performances.filter(
    (p) => current.has(p.showSlug) && Date.parse(p.startsAt) > now.getTime(),
  ).length
  return {
    person,
    fields,
    shows,
    archive,
    gallery,
    stats: { shows: shows.length, roles: shows.reduce((n, s) => n + s.roles.length, 0), upcoming },
  }
}
