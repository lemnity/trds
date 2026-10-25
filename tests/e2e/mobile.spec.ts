import type { Page } from '@playwright/test'

import { PERF_MAIN, SHOW_SLUG } from './support/env'
import { expect, signUpViaApi, test, uniqueEmail } from './support/fixtures'

/**
 * Смоук 360 px (design.md, rules.md §7): ключевые страницы без горизонтальной прокрутки.
 * Проверяем ширину документа после загрузки — переполнение любой карточкой, таблицей или
 * длинным словом даёт scrollWidth больше ширины окна.
 */

test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true })

const PAGES = [
  '/',
  '/afisha',
  `/shows/${SHOW_SLUG}`,
  `/checkout/${PERF_MAIN}?tickets=standard:2`,
  '/corporate',
  '/contacts',
  '/login',
  '/register',
]

const overflow = (page: Page) =>
  page.evaluate(() => {
    const doc = document.documentElement
    const wide = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1)
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80))
    return { scroll: doc.scrollWidth, client: doc.clientWidth, wide }
  })

for (const path of PAGES)
  test(`360 px без горизонтального скролла: ${path}`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('load')
    await expect(page.locator('h1').first()).toBeVisible()
    const result = await overflow(page)
    expect(result.scroll, JSON.stringify(result)).toBeLessThanOrEqual(result.client)
  })

test('360 px без горизонтального скролла: /account (вошедший)', async ({ page }) => {
  await signUpViaApi(page, uniqueEmail('mobile'))
  await page.goto('/account')
  await expect(page.getByRole('heading', { name: /Здравствуйте/ })).toBeVisible()
  await expect(page.getByText('Загружаем билеты…')).toBeHidden()
  const result = await overflow(page)
  expect(result.scroll, JSON.stringify(result)).toBeLessThanOrEqual(result.client)
})
