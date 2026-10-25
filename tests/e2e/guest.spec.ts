import { expect, test } from './support/fixtures'

/** Гость: кабинет закрыт серверной проверкой сессии (T-050), а не только меню. */
test('гость: /account перенаправляет на вход с возвратом в кабинет', async ({ page }) => {
  await page.goto('/account')
  await expect(page).toHaveURL(/\/login\?next=(\/|%2F)account$/)
  await expect(page.getByRole('button', { name: 'Получить код' })).toBeVisible()
})

test('гость: API кабинета отвечает 401 без данных', async ({ request }) => {
  for (const path of ['/api/account/tickets', '/api/loyalty/summary']) {
    const res = await request.get(path)
    expect(res.status(), path).toBe(401)
    expect(await res.json()).toMatchObject({ code: 'unauthorized' })
  }
})
