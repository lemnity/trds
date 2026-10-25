import type { SiteSeo } from '../content'

/**
 * SEO по умолчанию для всего сайта (T-022): из «Настроек сайта» в CMS, а что не заполнено —
 * из значений ниже (они же — на статической сборке и без базы). Страницы со своими
 * title/description их переопределяют; заголовок страницы встаёт в шаблон «%s — TURDUS».
 */

export const DEFAULT_SEO = {
  /** Картинка для ссылок по умолчанию (1200×630, public/og-default.jpg). */
  imageUrl: '/og-default.jpg',
  title: 'Модный театр TURDUS — Екатеринбург',
  description:
    'Иммерсивные спектакли модного театра TURDUS в Екатеринбурге: в барах, ресторанах, квартире и на улицах города.',
} as const

export type ResolvedSiteSeo = { title: string; description: string; imageUrl: string }

const clean = (v: string | undefined) => v?.trim() || undefined

/** Картинка для ссылок: абсолютный https или путь сайта (его дополнит metadataBase). */
const safeImage = (url: string | undefined) =>
  url && (/^https:\/\//i.test(url) || /^\/(?!\/)/.test(url)) ? url : null

export const resolveSiteSeo = (seo: SiteSeo | null | undefined): ResolvedSiteSeo => ({
  title: clean(seo?.title) ?? DEFAULT_SEO.title,
  description: clean(seo?.description) ?? DEFAULT_SEO.description,
  imageUrl: safeImage(clean(seo?.imageUrl)) ?? DEFAULT_SEO.imageUrl,
})
