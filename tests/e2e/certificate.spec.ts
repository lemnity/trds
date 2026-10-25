import { formatRub } from '../../src/lib/money'
import { expect, readCertificate, signUpViaApi, test, uniqueEmail } from './support/fixtures'

/** Подарочный сертификат (T-066, PRD §5.8): номинал зачисляется на бонусный баланс в кабинете. */
test('активация сертификата в кабинете поднимает баланс', async ({ page }) => {
  await signUpViaApi(page, uniqueEmail('cert'))
  const certificate = await readCertificate('activation')

  await page.goto('/account#certificate')
  const balance = page.locator('#bonuses').getByText('Баланс').locator('..')
  await expect(balance).toContainText(formatRub(0))

  const section = page.locator('#certificate')
  // Номер набирают как угодно: регистр и дефисы не важны.
  await section.getByLabel('Номер сертификата').fill(certificate.code.toLowerCase())
  await section.getByRole('button', { name: 'Активировать' }).click()
  await expect(section.getByRole('status')).toContainText(formatRub(certificate.amountKopecks))
  await expect(section.getByText(certificate.serial)).toBeVisible()
  await expect(balance).toContainText(formatRub(certificate.amountKopecks))

  // Повторная активация того же номера — отказ, баланс не меняется.
  await section.getByLabel('Номер сертификата').fill(certificate.code)
  await section.getByRole('button', { name: 'Активировать' }).click()
  await expect(section.getByText(/не найден или уже активирован/)).toBeVisible()
  const summary = (await (await page.request.get('/api/loyalty/summary')).json()) as {
    balanceKopecks: number
  }
  expect(summary.balanceKopecks).toBe(certificate.amountKopecks)
})
