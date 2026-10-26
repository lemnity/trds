import type { Page } from '@playwright/test'

import { expect, test } from './support/fixtures'

/**
 * Баннер cookie (T-036, PRD WEB-06/07): до явного согласия на аналитику — ни одного запроса
 * к mc.yandex.ru (номер счётчика на прогоне задан, NEXT_PUBLIC_YM_ID). Запросы к Метрике
 * перехватываются и не уходят в сеть.
 */

test.use({ consent: 'none' })

const trackMetrika = async (page: Page) => {
  const hits: string[] = []
  await page.route(/mc\.yandex\.(ru|com)/, (route) => {
    hits.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
  })
  return hits
}

test('без согласия Метрика не загружается; «Только необходимые» — тоже', async ({ page }) => {
  const hits = await trackMetrika(page)
  await page.goto('/')
  const banner = page.getByRole('region', { name: 'Cookie на сайте' })
  await expect(banner).toBeVisible()
  // Баннер не модальный: страница доступна, переходы работают.
  await page.getByRole('link', { name: 'Афиша' }).first().click()
  await expect(page).toHaveURL(/\/afisha/)
  await expect(banner).toBeVisible()
  await banner.getByRole('button', { name: 'Только необходимые' }).click()
  await expect(banner).toBeHidden()
  await page.reload()
  await expect(page.getByRole('region', { name: 'Cookie на сайте' })).toBeHidden()
  await page.goto('/contacts')
  await page.waitForLoadState('networkidle')
  expect(hits).toEqual([])
})

test('после «Принять» загружается счётчик; решение можно изменить в подвале', async ({ page }) => {
  const hits = await trackMetrika(page)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  expect(hits).toEqual([])
  const banner = page.getByRole('region', { name: 'Cookie на сайте' })
  await banner.getByRole('button', { name: 'Принять' }).click()
  await expect.poll(() => hits.some((u) => u.includes('/metrika/tag.js'))).toBe(true)
  await expect(banner).toBeHidden()

  // Отзыв: «Настройки cookie» → снять аналитику → страница перезагружается без счётчика.
  // В подвале кнопка может быть в меню «⋯», если строка документов не помещается.
  const more = page.getByRole('button', { name: 'Ещё документы' })
  if (await more.isVisible()) await more.click()
  await page.getByRole('button', { name: 'Настройки cookie' }).click()
  const settings = page.getByRole('region', { name: 'Cookie на сайте' })
  await settings.getByText('Аналитика — Яндекс Метрика').click()
  hits.length = 0
  await Promise.all([
    page.waitForEvent('load'),
    settings.getByRole('button', { name: 'Сохранить выбор' }).click(),
  ])
  await page.waitForLoadState('networkidle')
  expect(hits).toEqual([])
})
