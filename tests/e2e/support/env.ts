import path from 'node:path'

/**
 * Общие константы e2e (T-070). Данные — из `pnpm -s cms:seed` (демо-набор театра), после сида
 * global-setup переносит два показа «Трёх поэтов» в будущее относительно «сегодня» — иначе тесты
 * сломались бы, как только пройдут даты демо-афиши.
 */

export const ROOT = path.resolve(import.meta.dirname, '../../..')
/** Рабочий каталог прогона (в .gitignore): лог сервера, медиа сида, выпущенные сертификаты. */
export const E2E_DIR = path.join(ROOT, '.e2e')
export const CERTIFICATES_FILE = path.join(E2E_DIR, 'certificates.csv')
export const SERVER_LOG = path.join(E2E_DIR, 'next-dev.log')

export const SHOW_SLUG = 'three-poets'
export const SHOW_TITLE = 'Три поэта'
/** Основной показ: 20 мест по 1000 ₽, ближайший у спектакля — его выбирает страница по умолчанию. */
export const PERF_MAIN = 'three-poets-1110'
/** «Последние билеты» для конкурентного теста (T-071): вместимость урезана до LAST_CAPACITY. */
export const PERF_LAST = 'three-poets-1103'
export const LAST_CAPACITY = 3
export const TICKET_TYPE = 'standard'
export const TICKET_PRICE_KOPECKS = 100_000

/** Номинал сертификатов, которые выпускает global-setup (рубли) и их число. */
export const CERTIFICATE_RUBLES = 500
export const CERTIFICATE_COUNT = 20

/** Адрес сервера и базы прогона — global-setup кладёт их в окружение, воркеры наследуют. */
export const baseUrl = () => {
  const url = process.env.E2E_BASE_URL
  if (!url) throw new Error('E2E_BASE_URL is not set: run через `pnpm test:e2e` (global-setup)')
  return url
}

export const databaseUrl = () => {
  const url = process.env.E2E_RESOLVED_DATABASE_URL
  if (!url) throw new Error('E2E_RESOLVED_DATABASE_URL is not set (global-setup)')
  return url
}
