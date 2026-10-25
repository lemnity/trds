import type { Payload } from 'payload'

import { siteContentFromCms, type CmsContentDocs } from '../content/cms'
import { demoSiteContent, type SiteContent } from '../content'
import { showsDataFromCms, type CmsShowsDocs } from '../shows/cms'
import { demoShowsData, type ShowsData } from '../shows'

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

type Logger = { warn: (message: string) => void }

export function createSiteData({
  reader,
  env = process.env,
  logger = console,
}: {
  reader: () => Promise<CmsReader>
  env?: Env
  logger?: Logger
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

  return {
    async loadShowsData(): Promise<ShowsData> {
      const docs = await fromCms((r) => r.showsDocs())
      return docs ? showsDataFromCms(docs) : demoShowsData
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

let shared: SiteData | undefined

/** Данные сайта для серверных страниц (один экземпляр на процесс). */
export const siteData = (): SiteData => (shared ??= createSiteData({ reader: payloadReader }))

export const loadShowsData = () => siteData().loadShowsData()
export const loadSiteContent = () => siteData().loadSiteContent()
