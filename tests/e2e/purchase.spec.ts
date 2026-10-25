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

  // Возврат: по умолчанию в кабинете выключен (заглушка политики) — включаем, как сделал бы
  // администратор в /admin/refunds; срок 0 ч, чтобы показ через 30 дней точно подходил.
  const db = openDb()
  try {
    await db.execute(sql`
      insert into commerce_settings (key, value, updated_by, updated_at)
      values ('refund_policy', ${JSON.stringify({
        customerRefundsEnabled: true,
        deadlineHoursBeforeStart: 0,
        allowPartial: true,
        refundServiceFee: false,
        returnToSale: true,
      })}::jsonb, 'e2e', now())
      on conflict (key) do update
      set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`)

    await dialog.getByRole('button', { name: 'Вернуть билет' }).click()
    const refund = dialog.getByRole('region', { name: 'Возврат билета' })
    // Сумма и последствия — до подтверждения (rules.md §7). Билет — половина заказа:
    // половина денег и половина бонусов; сбор по правилам-заглушке не возвращается.
    await expect(refund).toContainText('Вернётся на карту')
    await expect(refund).toContainText('Сервисный сбор не возвращается')
    await refund.getByRole('button', { name: /^Подтвердить возврат/ }).click()
    await expect(dialog.getByText(/^Возврат (выполнен|оформлен)$/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Закрыть' }).click()

    // Статус в кабинете: билет переехал во «Возвраты».
    await page.getByRole('tab', { name: /Возвраты/ }).click()
    const refunded = page
      .getByRole('tabpanel')
      .getByRole('listitem')
      .filter({ hasText: ticketNumber })
    await expect(refunded).toContainText(/Возвращён|Возврат обрабатывается/)
    await page.getByRole('tab', { name: /Будущие/ }).click()
    await expect(page.getByRole('tabpanel').getByRole('listitem')).toHaveCount(1)

    // В базе — один возврат одного билета (деньги вернул учебный банк).
    const refunds = await rows<{ status: string; tickets: number }>(
      db,
      sql`select r.status, count(rt.*)::int as tickets
          from commerce_refunds r join commerce_refund_tickets rt on rt.refund_id = r.id
          join commerce_tickets t on t.id = rt.ticket_id
          where t.number = ${ticketNumber} group by r.id`,
    )
    expect(refunds).toEqual([{ status: 'SUCCEEDED', tickets: 1 }])
  } finally {
    await closeDb(db)
  }
})
