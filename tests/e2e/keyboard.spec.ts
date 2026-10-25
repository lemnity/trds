import type { Locator, Page } from '@playwright/test'

import { SHOW_SLUG } from './support/env'
import { expect, test, uniqueEmail } from './support/fixtures'

/**
 * Покупка только с клавиатуры (rules.md §7, WCAG 2.1.1): Tab/Shift+Tab, Enter, пробел — без
 * единого клика мышью. Гость: страница спектакля → «Оформить заказ» → форма → учебный банк →
 * «Оплачено». Каждый шаг доходит до элемента табуляцией и проверяет, что фокус виден.
 */

const MAX_TABS = 80

/** Нажимать Tab, пока фокус не окажется на `target`; фокус обязан быть видимым (focus-visible). */
async function tabTo(page: Page, target: Locator) {
  const handle = await target.elementHandle()
  for (let i = 0; i < MAX_TABS; i++) {
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(
      (el) => el !== null && (el === document.activeElement || el.contains(document.activeElement)),
      handle,
    )
    if (focused) {
      const visible = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        return Boolean(el?.matches(':focus-visible'))
      })
      expect(visible, 'фокус виден (:focus-visible)').toBe(true)
      return
    }
  }
  throw new Error(`не дошли табуляцией до ${target}`)
}

test('гость оформляет и оплачивает билет только клавиатурой', async ({ page }) => {
  await page.goto(`/shows/${SHOW_SLUG}`)
  await expect(page.getByRole('heading', { name: 'Сколько билетов?' })).toBeVisible()

  // Количество: стрелка вверх в поле количества — второй билет.
  const quantity = page.getByRole('textbox', { name: 'Входной билет' })
  await tabTo(page, quantity)
  await page.keyboard.press('ArrowUp')
  await expect(quantity).toHaveValue('2')
  const order = page.getByRole('link', { name: 'Оформить заказ' })
  await tabTo(page, order)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/checkout\//)

  const form = page.getByRole('form', { name: 'Данные покупателя' })
  await tabTo(page, form.getByLabel('Имя и фамилия'))
  await page.keyboard.type('Клавиатурный Гость')
  await page.keyboard.press('Tab')
  await page.keyboard.type(uniqueEmail('keyboard'))
  // Способ оплаты: группа радиокнопок — карта выбрана по умолчанию, стрелки меняют выбор.
  const card = form.getByRole('radio', { name: /Банковская карта/ })
  await tabTo(page, card)
  await page.keyboard.press('ArrowRight')
  await expect(form.getByRole('radio', { name: /СБП/ })).toBeChecked()
  await page.keyboard.press('ArrowLeft')
  await expect(card).toBeChecked()
  // Отправка без галочек: фокус уходит на первое поле с ошибкой.
  const pay = form.getByRole('button', { name: /^Оплатить/ })
  await tabTo(page, pay)
  await page.keyboard.press('Enter')
  const rules = form.getByRole('checkbox', { name: /правилами продажи/ })
  await expect(rules).toBeFocused()
  await page.keyboard.press('Space')
  await expect(rules).toBeChecked()
  const consent = form.getByRole('checkbox', { name: /обработку персональных данных/ })
  await tabTo(page, consent)
  await page.keyboard.press('Space')
  await expect(consent).toBeChecked()
  await tabTo(page, pay)
  await page.keyboard.press('Enter')

  // Учебный банк — обычная HTML-форма.
  await expect(page).toHaveURL(/\/api\/payments\/fake\/bank/)
  await tabTo(page, page.getByRole('button', { name: 'Оплатить', exact: true }))
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/checkout\/result/)
  await expect(page.getByText('Оплата подтверждена')).toBeVisible()
})
