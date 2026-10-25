import { demoShowsData } from './demo-data'
import type { ShowsData } from './types'

/**
 * Демо-набор афиши (синхронно). Страницы сайта читают CMS через `@/modules/site-data`
 * (`loadShowsData`); эта функция остаётся для кода, которому нужен только демо-набор, и для
 * ещё не переведённых вызовов (оформление заказа, вход).
 * @deprecated для страниц — используйте loadShowsData из @/modules/site-data.
 */
export const getShowsData = (): ShowsData => demoShowsData
