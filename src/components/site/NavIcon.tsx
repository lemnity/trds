/** Значки пунктов подменю — линейные, 24px, цвет текста (как в референсе заказчика). */
export type NavIconName =
  'theatre' | 'venues' | 'repertoire' | 'troupe' | 'leadership' | 'partners' | 'news' | 'reviews'

const PATHS: Record<NavIconName, string> = {
  // Здание театра: фронтон, колонны, ступени.
  theatre: 'M3 9.5 12 4l9 5.5M4 10h16M6 10v7.5M10 10v7.5M14 10v7.5M18 10v7.5M3 20h18M4.5 18h15',
  // Площадка: метка на карте.
  venues:
    'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  // Репертуар: список с маркерами.
  repertoire:
    'M9 6.5h11M9 12h11M9 17.5h11M4 5.5h2v2H4zM5 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM4 18.5 5 16.5l1 2Z',
  // Труппа: три силуэта.
  troupe:
    'M12 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM7.5 19.5c0-2.8 2-4.5 4.5-4.5s4.5 1.7 4.5 4.5M5.5 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM2.5 18c0-2.2 1.3-3.6 3.2-3.9M18.5 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM21.5 18c0-2.2-1.3-3.6-3.2-3.9',
  // Руководство: человек с галстуком.
  leadership:
    'M12 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM5 20.5c.6-4 3.3-6.5 7-6.5s6.4 2.5 7 6.5M12 14l-1 2 1 4 1-4-1-2Z',
  // Партнёры: рукопожатие.
  partners:
    'M2.5 11 6 7.5l3 1.5 3-1.5 3 1.5 3-1.5 3.5 3.5M6 13.5l3.5 3.5a1.4 1.4 0 0 0 2-2M11 16l1.5 1.5a1.4 1.4 0 0 0 2-2l-3-3M14 14l1.2 1.2a1.4 1.4 0 0 0 2-2L13 9',
  // Новости: газета.
  news: 'M5 4.5h11v15H6.5A1.5 1.5 0 0 1 5 18V4.5ZM16 8.5h3v9.5a1.5 1.5 0 0 1-3 0M8 8h5M8 11.5h5M8 15h3',
  // Отзывы: облачко реплики.
  reviews: 'M4.5 5.5h15v10h-8l-4 3.5v-3.5h-3v-10ZM8 9.5h8M8 12.5h5',
}

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path
        d={PATHS[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
