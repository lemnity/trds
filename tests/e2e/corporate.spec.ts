import { randomBytes } from 'node:crypto'

import { rows, sql, withDb } from './support/db'
import { expect, test, uniqueEmail } from './support/fixtures'

/**
 * Заявка на корпоратив (T-034, T-065). Повтор после обрыва связи: первый ответ сервера до
 * браузера «не доходит» (заявка при этом сохранена), зритель жмёт «Отправить» ещё раз — уходит
 * тот же ключ, сервер отвечает «уже принято», в базе одна заявка.
 */
test('заявка на корпоратив: отправка и повтор без дубля', async ({ page }) => {
  const name = `Ольга E2E ${randomBytes(3).toString('hex')}`
  await page.goto('/corporate')
  const form = page.getByRole('form', { name: 'Заявка на корпоратив' })
  await form.getByLabel('Имя').fill(name)
  await form.getByLabel('E-mail').fill(uniqueEmail('lead'))
  await form.getByLabel('Гостей').fill('40')
  await form.getByLabel('Комментарий').fill('Новогодний вечер для команды')
  // Без согласия — ошибка у поля, запрос не уходит.
  await form.getByRole('button', { name: 'Отправить заявку' }).click()
  await expect(form.getByText(/согласие/i).last()).toBeVisible()
  await form.getByText('Согласен на обработку персональных данных для ответа на заявку').click()

  const keys: string[] = []
  let lost = false
  await page.route('**/api/leads', async (route) => {
    keys.push((route.request().postDataJSON() as { idempotencyKey: string }).idempotencyKey)
    if (lost) return route.continue()
    // Сервер получил и сохранил заявку, а ответ потерялся по дороге.
    lost = true
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    await route.abort('connectionreset')
  })

  await form.getByRole('button', { name: 'Отправить заявку' }).click()
  await expect(form.getByText('Заявка не отправлена')).toBeVisible()
  await expect(form).toContainText('повторная отправка не создаст дубль')
  await form.getByRole('button', { name: 'Отправить заявку' }).click()
  await expect(page.getByText('Заявка принята')).toBeVisible()

  expect(keys).toHaveLength(2)
  expect(keys[1]).toBe(keys[0])
  const leads = await withDb((db) =>
    rows<{ status: string; guests: number; source: string }>(
      db,
      sql`select status, guests, source from leads_requests where name = ${name}`,
    ),
  )
  expect(leads).toEqual([{ status: 'new', guests: 40, source: 'corporate' }])
})
