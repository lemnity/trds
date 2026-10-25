import type { Payload } from 'payload'

import { siteContentFromCms, type CmsContentDocs } from '../content/cms'
import { demoSiteContent, type SiteContent } from '../content'
import { showsDataFromCms, type CmsShowsDocs } from '../shows/cms'
import {
  applyStock,
  demoShowsData,
  stockPerformanceIds,
  type ShowsData,
  type ShowStock,
} from '../shows'

/**
 * Источник данных публичного сайта (T-021, T-022, T-025, T-026): опубликованное из Payload,
 * если есть база, иначе демо-набор (`@/modules/shows` demo-data, `@/modules/content`). Типы у
 * обоих источников одни. Только для сервера: модуль подтягивает Payload — клиентские компоненты
 * его не импортируют (они получают данные пропсами).
 *
 * Выбор (`CONTENT_SOURCE`):
 * - статическая сборка GitHub Pages (PAGES_EXPORT / NEXT_PUBLIC_STATIC_PREVIEW) или нет
 *   DATABASE_URL — демо-набор; базы там нет, сборка в CI её не требует;
 * - `demo` — демо-набор принудительно;
 * - `cms` — строго CMS: ошибка базы — ошибка страницы, пустая CMS — пустая афиша;
 * - по умолчанию (`auto`) — CMS; вне production при недоступной базе или ещё не наполненной
 *   CMS (ни одного спектакля, даже черновика: не запускали `pnpm cms:seed`) — демо-набор с
 *   предупреждением в лог. В production демо-данные молча не подставляются.
 */

export type Env = Record<string, string | undefined>
export type ContentSource = 'cms' | 'demo'

export const isStaticExport = (env: Env = process.env) =>
  env.PAGES_EXPORT === '1' || env.NEXT_PUBLIC_STATIC_PREVIEW === '1'

export const contentSource = (env: Env = process.env): ContentSource =>
  isStaticExport(env) || env.CONTENT_SOURCE === 'demo' || !env.DATABASE_URL ? 'demo' : 'cms'

/** Чтение опубликованного из CMS (Payload Local API с правами анонимного посетителя). */
export interface CmsReader {
  showsDocs(): Promise<CmsShowsDocs>
  contentDocs(): Promise<CmsContentDocs>
  /** Все спектакли, включая черновики: 0 — CMS ещё не наполнена. */
  countAllShows(): Promise<number>
}

/** Остатки показов из ядра продаж одним пакетом (`@/modules/inventory` `availabilityOf`). */
export type StockReader = (performanceIds: string[]) => Promise<ReadonlyMap<string, ShowStock>>

type Logger = { warn: (message: string) => void }

export function createSiteData({
  reader,
  stock,
  env = process.env,
  logger = console,
  now = () => new Date(),
}: {
  reader: () => Promise<CmsReader>
  /** Нет — витрина показывает квоты CMS как есть. */
  stock?: StockReader
  env?: Env
  logger?: Logger
  now?: () => Date
}) {
  const strict = env.CONTENT_SOURCE === 'cms' || env.NODE_ENV === 'production'

  /** CMS или демо; `null` — использовать демо-набор. */
  async function fromCms<T>(read: (r: CmsReader) => Promise<T>): Promise<T | null> {
    if (contentSource(env) === 'demo') return null
    try {
      const r = await reader()
      if (!strict && (await r.countAllShows()) === 0) {
        logger.warn('[site-data] CMS пуста — показываем демо-набор (pnpm cms:seed)')
        return null
      }
      return await read(r)
    } catch (error) {
      if (strict) throw error
      logger.warn(
        `[site-data] CMS недоступна (${error instanceof Error ? error.name : 'unknown'}) — показываем демо-набор`,
      )
      return null
    }
  }

  /**
   * Наложить остатки ядра продаж (одним запросом на все будущие показы). Сбой чтения остатков
   * не роняет афишу: показываем квоты CMS с предупреждением в лог — продажу сверх остатка всё
   * равно не допустит `acquire` при оформлении (409 «билетов не осталось»).
   */
  async function withStock(data: ShowsData): Promise<ShowsData> {
    if (!stock) return data
    const ids = stockPerformanceIds(data, now())
    if (!ids.length) return data
    try {
      return applyStock(data, await stock(ids))
    } catch (error) {
      logger.warn(
        `[site-data] остатки недоступны (${error instanceof Error ? error.name : 'unknown'}) — показываем квоты CMS`,
      )
      return data
    }
  }

  return {
    /** Афиша как в CMS (квоты без учёта продаж) — для оформления заказа, его проверяет acquire. */
    async loadShowsData(): Promise<ShowsData> {
      const docs = await fromCms((r) => r.showsDocs())
      return docs ? showsDataFromCms(docs) : demoShowsData
    },
    /**
     * Афиша для страниц: CMS + настоящие остатки. Демо-набор (превью, нет базы, пустая CMS)
     * остаётся как есть — его показы в ядре продаж не синхронизируются.
     */
    async loadSiteShows(): Promise<ShowsData> {
      const docs = await fromCms((r) => r.showsDocs())
      return docs ? withStock(showsDataFromCms(docs)) : demoShowsData
    },
    async loadSiteContent(): Promise<SiteContent> {
      const docs = await fromCms((r) => r.contentDocs())
      return docs ? siteContentFromCms(docs, demoSiteContent) : demoSiteContent
    },
  }
}

export type SiteData = ReturnType<typeof createSiteData>

/** Читатель Payload: только опубликованное (draft: false, overrideAccess: false — как аноним). */
export async function payloadReader(): Promise<CmsReader> {
  // Динамический импорт: статическая сборка и тесты без базы не загружают Payload вовсе.
  const [{ getPayload }, { default: config }] = await Promise.all([
    import('payload'),
    import('@payload-config'),
  ])
  return payloadReaderFor(await getPayload({ config }))
}

export function payloadReaderFor(payload: Payload): CmsReader {
  const PUBLISHED = { _status: { equals: 'published' } } as const
  const common = {
    draft: false,
    overrideAccess: false,
    pagination: false,
  } as const

  return {
    async showsDocs() {
      const [shows, venues, performances, ticketTypes, archive] = await Promise.all([
        payload.find({ collection: 'shows', where: PUBLISHED, depth: 1, joins: false, ...common }),
        payload.find({
          collection: 'venues',
          where: PUBLISHED,
          depth: 0,
          sort: 'sortOrder',
          ...common,
        }),
        payload.find({
          collection: 'performances',
          where: PUBLISHED,
          depth: 1,
          joins: false,
          ...common,
        }),
        payload.find({ collection: 'ticket-types', depth: 0, ...common }),
        payload.find({
          collection: 'archive',
          where: PUBLISHED,
          depth: 1,
          sort: 'sortOrder',
          ...common,
        }),
      ])
      return {
        shows: shows.docs,
        venues: venues.docs,
        performances: performances.docs,
        ticketTypes: ticketTypes.docs,
        archive: archive.docs,
      }
    },
    async contentDocs() {
      const [news, reviews, partners, documents, people, pages, settings] = await Promise.all([
        payload.find({ collection: 'news', where: PUBLISHED, depth: 1, ...common }),
        payload.find({ collection: 'reviews', where: PUBLISHED, depth: 0, ...common }),
        payload.find({ collection: 'partners', where: PUBLISHED, depth: 1, ...common }),
        payload.find({ collection: 'documents', where: PUBLISHED, depth: 0, ...common }),
        payload.find({ collection: 'people', where: PUBLISHED, depth: 1, ...common }),
        payload.find({ collection: 'pages', where: PUBLISHED, depth: 1, ...common }),
        payload.findGlobal({ slug: 'site-settings', depth: 1, overrideAccess: false }),
      ])
      return {
        news: news.docs,
        reviews: reviews.docs,
        partners: partners.docs,
        documents: documents.docs,
        people: people.docs,
        pages: pages.docs,
        // Глобал ещё ни разу не сохраняли — пустой объект без контактов.
        settings: settings?.contacts?.phone ? settings : null,
      }
    },
    async countAllShows() {
      return (await payload.count({ collection: 'shows', overrideAccess: true })).totalDocs
    },
  }
}

/** Остатки из ядра продаж; модуль подгружается лениво — статическая сборка его не трогает. */
export const inventoryStock: StockReader = async (performanceIds) => {
  const { getInventory } = await import('../inventory')
  return (await getInventory()).availabilityOf(performanceIds)
}

let shared: SiteData | undefined

/** Данные сайта для серверных страниц (один экземпляр на процесс). */
export const siteData = (): SiteData =>
  (shared ??= createSiteData({ reader: payloadReader, stock: inventoryStock }))

export const loadShowsData = () => siteData().loadShowsData()
export const loadSiteShows = () => siteData().loadSiteShows()
export const loadSiteContent = () => siteData().loadSiteContent()

export { DEFAULT_SEO, resolveSiteSeo, type ResolvedSiteSeo } from './seo'
