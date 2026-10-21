/**
 * Публичный адрес сайта — для canonical, Open Graph и sitemap. Задаётся при сборке
 * (`NEXT_PUBLIC_SITE_URL`); по умолчанию — домен театра, куда переедет сайт (T-004, T-075).
 * Превью на GitHub Pages закрыто от индексации, canonical там указывает на домен театра.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://teatrturdus.ru').replace(
  /\/$/,
  '',
)

/** Превью на GitHub Pages — не индексируется (robots, meta). */
export const IS_PREVIEW = process.env.PAGES_EXPORT === '1'

/** Open Graph страницы со своей картинкой (общие поля сайта повторяем — Next не сливает openGraph). */
export const pageOpenGraph = (title: string, image?: string, description?: string) => ({
  siteName: 'Модный театр TURDUS',
  locale: 'ru_RU',
  type: 'website' as const,
  title,
  ...(description && { description }),
  ...(image && { images: [{ url: image }] }),
})
