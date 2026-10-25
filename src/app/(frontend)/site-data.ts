import type { StaticImageData } from 'next/image'
import { connection } from 'next/server'
import { cache } from 'react'

import { personPhotos } from '@/components/people/personPhotos'
import { demoSiteContent } from '@/modules/content'
import { demoShowsData } from '@/modules/shows'
import { isStaticExport, loadShowsData, loadSiteContent } from '@/modules/site-data'

/**
 * Данные публичных страниц (CMS или демо — @/modules/site-data), один запрос на рендер.
 *
 * На сервере страницы рендерятся по запросу (`connection()`): образ собирается без базы, а
 * правки редактора видны сразу, без пересборки. Статическая сборка GitHub Pages — без сервера
 * и без базы: `connection()` не вызывается, страницы пререндерятся из демо-набора.
 */
const perRequest = async () => {
  if (!isStaticExport()) await connection()
}

/**
 * Сборка серверного образа идёт без базы. Страницы до сюда не доходят (их останавливает
 * connection()), а route handlers (sitemap) — доходят: им при сборке отдаём демо-набор.
 */
const buildPhase = () => process.env.NEXT_PHASE === 'phase-production-build' && !isStaticExport()

export const getSiteShows = cache(async () => {
  await perRequest()
  return buildPhase() ? demoShowsData : loadShowsData()
})

export const getSiteContent = cache(async () => {
  await perRequest()
  return buildPhase() ? demoSiteContent : loadSiteContent()
})

/** Портреты: из CMS (файлы «Медиа»), без CMS — из src/assets/people. */
export const getPersonPhotos = cache(
  async (): Promise<Record<string, StaticImageData>> =>
    (await getSiteContent()).portraits ?? personPhotos,
)

/**
 * Для generateStaticParams: статическая сборка перечисляет страницы демо-набора; на сервере —
 * ничего заранее (страницы рендерятся по запросу, адреса из CMS появляются без пересборки).
 */
export const staticShowsData = () => (isStaticExport() ? demoShowsData : null)
export const staticSiteContent = () => (isStaticExport() ? demoSiteContent : null)
