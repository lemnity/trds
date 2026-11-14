import { formatRub } from '../../src/lib/money'
import { closeDb, openDb, rows, sql } from './support/db'
import { PERF_MAIN, SHOW_TITLE, TICKET_PRICE_KOPECKS } from './support/env'
import {
  apiHeaders,
  expect,
  readCertificate,
  signUpViaApi,
  test,
  uniqueEmail,
} from './support/fixtures'

/**
 * Главный путь покупки (T-044…T-046, T-051, T-052) на учебном банке: главная → спектакль →
 * 2 билета → оформление вошедшим зрителем со списанием бонусов → «Оплатить» в банке →
 * страница результата берёт статус с сервера → «Мои билеты» с QR → возврат из кабинета.
 */

const FEE_PER_TICKET = 20_000 // сервисный сбор-заглушка, src/modules/checkout/fees.ts

test.describe.configure({ mode: 'serial' })

test('покупка с бонусами, QR в кабинете и возврат', async ({ page }) => {
  const email = uniqueEmail('buyer')
  await signUpViaApi(page, email, 'Анна Покупатель')

  // Бонусный баланс — сертификатом (номинал зачисляется на бонусный счёт, PRD §5.8).
  const certificate = await readCertificate('purchase')
  const activated = await page.request.post('/api/loyalty/certificates/activate', {
    headers: apiHeaders(),
    data: { code: certificate.code },
  })
  expect(activated.status(), await activated.text()).toBe(200)
  const balance = certificate.amountKopecks

  // Главная → спектакль.
  await page.goto('/')
  // Dev-сервер: клик до окончания гидрации иногда теряется — ждём, пока страница успокоится.
  await page.waitForLoadState('networkidle')
  await page
    .getByRole('link', { name: new RegExp(SHOW_TITLE) })
    .first()
    .click()
  await expect(page).toHaveURL(/\/shows\/three-poets/)
  await expect(page.getByRole('heading', { name: 'Сколько билетов?' })).toBeVisible()

  // Выбор: по умолчанию 1 билет ближайшего показа — добавляем второй.
  await page.getByRole('button', { name: 'Добавить билет: Входной билет' }).click()
  const bar = page.getByRole('status').filter({ hasText: 'Оформить заказ' })
  await expect(bar).toContainText('2 билета')
  await expect(bar).toContainText(formatRub(2 * TICKET_PRICE_KOPECKS))
  await page.getByRole('link', { name: 'Оформить заказ' }).click()
  await expect(page).toHaveURL(new RegExp(`/checkout/${PERF_MAIN}\\?tickets=standard(:|%3A)2`))

  // Оформление: бонусы видит только вошедший; списание ограничено 30% и балансом.
  const form = page.getByRole('form', { name: 'Данные покупателя' })
  await form.getByLabel('Имя и фамилия').fill('Анна Покупатель')
  await form.getByLabel('E-mail').fill(email)
  const bonus = form.getByRole('region', { name: 'Бонусы' })
  await expect(bonus).toContainText(`Доступно ${formatRub(balance)}`)
  const tickets = 2 * TICKET_PRICE_KOPECKS
  const spend = Math.min(balance, (tickets * 30) / 100)
  await bonus.getByRole('button', { name: 'Списать максимум' }).click()
  await expect(bonus.getByLabel('Списать бонусами, ₽')).toHaveValue(String(spend / 100))
  await form.getByText('Согласен с правилами продажи и возврата билетов').click()
  await form.getByText('Согласен на обработку персональных данных для оформления билетов').click()
  const cash = tickets - spend + 2 * FEE_PER_TICKET
  const pay = form.getByRole('button', { name: /^Оплатить/ })
  await expect(pay).toHaveText(new RegExp(formatRub(cash).replace(/\s/g, '\\s*')))
  await pay.click()

  // Учебный банк: сумма — от сервера (не из браузера).
  await expect(page).toHaveURL(/\/api\/payments\/fake\/bank\?payment=/)
  await expect(page.locator('.sum')).toHaveText(formatRub(cash))
  await page.getByRole('button', { name: 'Оплатить', exact: true }).click()

  // Результат: статус с сервера, после подписанного уведомления банка.
  await expect(page).toHaveURL(/\/checkout\/result\?order=/)
  await expect(page.getByText('Оплата подтверждена')).toBeVisible()
  await expect(page.getByText(/оплачен: /)).toContainText(formatRub(cash))

  // «Мои билеты»: два действующих билета с QR.
  await page.getByRole('link', { name: '«Мои билеты»' }).click()
  await expect(page).toHaveURL(/\/account#tickets/)
  const upcoming = page.getByRole('tabpanel')
  const cards = upcoming.getByRole('listitem').filter({ hasText: SHOW_TITLE })
  await expect(cards).toHaveCount(2)
  await expect(cards.first()).toContainText('Действует')
  await cards.first().getByRole('button', { name: 'Показать QR' }).click()
  const dialog = page.getByRole('dialog')
  const qr = dialog.getByRole('img', { name: /QR-код билета/ })
  await expect(qr).toBeVisible()
  await expect
    .poll(() => qr.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0)
  await expect(dialog).toContainText(`Оплачено бонусами−${formatRub(spend)}`)
  const ticketNumber = (await qr.getAttribute('alt'))!.replace('QR-код билета ', '')

  // Возврат — заявка (ст. 52.1 Закона о культуре): показ через 30 дней, значит по закону 100%
  // номинала, сбор не возвращается. Деньги уходят после решения театра — до него билет действует.
  const db = openDb()
  try {
    await dialog.getByRole('button', { name: 'Вернуть билет' }).click()
    const claim = dialog.getByRole('region', { name: 'Заявка на возврат' })
    await claim.getByRole('radio', { name: 'Не смогу пойти / передумал' }).check()
    await expect(claim).toContainText('По закону вернётся на карту (100%)')
    await expect(claim).toContainText('Сервисный сбор не возвращается')
    await claim.getByRole('button', { name: 'Отправить заявку' }).click()
    await expect(dialog.getByText(/^Заявка на возврат ВЗ-/)).toBeVisible()
    await expect(dialog).toContainText('На рассмотрении')
    await dialog.getByRole('button', { name: 'Закрыть' }).click()

    // Билет действует, пока заявку не одобрили: оба билета — в «Будущих».
    await expect(page.getByRole('tabpanel').getByRole('listitem')).toHaveCount(2)

    // Кнопка «Вернуть» на карточке другого билета сразу открывает форму заявки, без QR.
    const other = page
      .getByRole('tabpanel')
      .getByRole('listitem')
      .filter({ hasNotText: ticketNumber })
      .first()
    await other.getByRole('button', { name: /^Вернуть билет/ }).click()
    const second = page.getByRole('dialog')
    await expect(second.getByRole('region', { name: 'Заявка на возврат' })).toContainText(
      'Почему возвращаете билет?',
    )
    await expect(second.getByRole('img', { name: /QR-код билета/ })).toHaveCount(0)
    await second.getByRole('button', { name: 'Отмена' }).click()
    await second.getByRole('button', { name: 'Закрыть' }).click()

    // В базе — одна открытая заявка на 100%, возвратов через банк ещё нет.
    const claims = await rows<{ status: string; legal_percent: number }>(
      db,
      sql`select c.status, c.legal_percent from commerce_refund_claims c
          join commerce_refund_claim_tickets ct on ct.claim_id = c.id
          join commerce_tickets t on t.id = ct.ticket_id
          where t.number = ${ticketNumber}`,
    )
    expect(claims).toEqual([{ status: 'SUBMITTED', legal_percent: 100 }])
    const refunds = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from commerce_refund_tickets rt
          join commerce_tickets t on t.id = rt.ticket_id where t.number = ${ticketNumber}`,
    )
    expect(refunds).toEqual([{ n: 0 }])
  } finally {
    await closeDb(db)
  }
})
