import { plural } from '@/lib/plural'

/** Счётчики сверху кабинета: подпись по числу («1 билет впереди», «3 друга приглашено»). */
const STAT_FORMS = {
  upcoming: ['билет впереди', 'билета впереди', 'билетов впереди'],
  visited: ['спектакль посещён', 'спектакля посещено', 'спектаклей посещено'],
  friends: ['друг приглашён', 'друга приглашено', 'друзей приглашено'],
} as const

export type AccountStatKind = keyof typeof STAT_FORMS

/** null — число ещё не известно (прочерк): общая форма «билетов впереди». */
export const accountStatLabel = (kind: AccountStatKind, n: number | null) => {
  const [one, few, many] = STAT_FORMS[kind]
  return n === null ? many : plural(n, one, few, many)
}
