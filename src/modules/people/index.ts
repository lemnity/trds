import type { ShowsData } from '@/modules/shows'

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

export const listPeople = (data: ShowsData): Person[] => {
  const people = new Map<string, Person>()
  for (const show of publishedShows(data))
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
