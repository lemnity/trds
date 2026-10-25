import { rows, sql, withDb } from './support/db'
import { apiHeaders, expect, readCode, signUpViaApi, test, uniqueEmail } from './support/fixtures'

/**
 * Вход и регистрация кодом из письма (T-050) и «Приведи 3 друга» (T-062): ссылка `/register?ref=`
 * привязывает нового зрителя к пригласившему; затем — выход и вход по коду. Письма — локальный
 * ящик dev-сервера (`/api/dev/outbox`).
 */

test('регистрация по ссылке друга (?ref=) и вход по коду', async ({ page, request }) => {
  // Пригласивший — отдельный зритель со своей сессией (контекст `request`).
  const referrerEmail = uniqueEmail('referrer')
  await signUpViaApi(request, referrerEmail, 'Пригласивший')
  const summary = await request.get('/api/loyalty/summary')
  expect(summary.status()).toBe(200)
  const { referral } = (await summary.json()) as { referral: { code: string; link: string } }
  expect(referral.link).toContain(`/register?ref=${encodeURIComponent(referral.code)}`)

  // Новый зритель открывает ссылку и регистрируется.
  const email = uniqueEmail('invitee')
  await page.goto(`/register?ref=${encodeURIComponent(referral.code)}`)
  await expect(page.getByText('Вас пригласил друг')).toBeVisible()
  await page.getByLabel('Имя').fill('Борис Приглашённый')
  await page.getByLabel('E-mail').fill(email)
  await page.getByRole('textbox', { name: /^Пароль/ }).fill('e2e-password-123')
  await page.getByText('Согласен на обработку персональных данных').click()
  let since = new Date(Date.now() - 1000)
  await page.getByRole('button', { name: 'Получить код' }).click()
  await expect(page.getByText(/Код отправлен на/)).toBeVisible()
  // Неверный код отклоняется, верный — входит (и уводит в кабинет).
  await page.getByLabel('Код из письма').fill('000000')
  await page.getByRole('button', { name: 'Подтвердить и войти' }).click()
  await expect(page.getByText(/Неверный или устаревший код/)).toBeVisible()
  await page.getByLabel('Код из письма').fill(await readCode(page.request, email, since))
  await page.getByRole('button', { name: 'Подтвердить и войти' }).click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole('heading', { name: 'Здравствуйте, Борис' })).toBeVisible()

  // Приглашение засчитано именно этой паре (и только одно).
  const referrals = await withDb((db) =>
    rows<{ referrer: string; invitee: string }>(
      db,
      sql`select r.email as referrer, c.email as invitee from wallet_referrals w
          join accounts_customers r on r.id = w.referrer_id
          join accounts_customers c on c.id = w.referred_customer_id
          where c.email = ${email}`,
    ),
  )
  expect(referrals).toEqual([{ referrer: referrerEmail, invitee: email }])

  // Выход — сессия отозвана на сервере: кабинет снова требует входа.
  const logout = await page.request.post('/api/auth/logout', { headers: apiHeaders() })
  expect(logout.ok()).toBe(true)
  await page.goto('/account')
  await expect(page).toHaveURL(/\/login\?next=/)

  // Повторный код можно запросить через 60 с после предыдущего (OTP_RULES.resendAfterSec):
  // сдвигаем время прошлого кода, чтобы не ждать минуту.
  await withDb((db) =>
    db.execute(sql`update accounts_auth_codes set created_at = created_at - interval '2 minutes'
                   where email = ${email}`),
  )
  await page.getByLabel('E-mail').fill(email)
  since = new Date(Date.now() - 1000)
  await page.getByRole('button', { name: 'Получить код' }).click()
  await page.getByLabel('Код из письма').fill(await readCode(page.request, email, since))
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByText(`Вы вошли как ${email}.`)).toBeVisible()
})
