/**
 * Зонные схемы: зал разделён на зоны без нумерованных мест (лофт, свободная рассадка). Каждая
 * зона продаётся как категория билетов: цена и вместимость задаются на показ в админке
 * («Схема зала и цены мест»), остаток — в inventory по ключу зоны, как у обычных категорий.
 */
export type SeatZone = {
  /** Ключ категории билетов в заказах — не меняется после первых продаж. */
  id: string
  title: string
  color: string
}

export type ZonePlan = {
  kind: 'zones'
  id: string
  version: number
  venueId: string
  title: string
  /** Сверху вниз от сцены. */
  zones: SeatZone[]
}

/**
 * Лофт «Батон», Хлебозавод №6 — схема театра (получена 19.11.2026): сцена и четыре зоны
 * друг за другом. Вместимость зон на схеме не указана — задаётся на показ.
 */
export const khlebozavodPlan: ZonePlan = {
  kind: 'zones',
  id: 'khlebozavod',
  version: 1,
  venueId: 'baton',
  title: 'Хлебозавод',
  zones: [
    { id: 'bulochka', title: 'Партер «Булочка»', color: '#e30613' },
    { id: 'sdoba', title: 'Амфитеатр «Сдоба»', color: '#f0920b' },
    { id: 'keks', title: 'Галерка «Кекс»', color: '#00a8e1' },
    { id: 'rogalik', title: 'Галерка 2 «Рогалик»', color: '#949c0a' },
  ],
}
