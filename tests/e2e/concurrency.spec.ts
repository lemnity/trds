import { randomUUID } from 'node:crypto'

import { rows, sql, withDb } from './support/db'
import { LAST_CAPACITY, PERF_LAST, PERF_MAIN, SHOW_SLUG, TICKET_TYPE } from './support/env'
import { apiHeaders, expect, randomIp, test, uniqueEmail } from './support/fixtures'

/**
 * T-071 через HTTP: много параллельных `POST /api/checkout` на последние билеты показа.
 * Каждый запрос — «отдельный зритель» (свой адрес за прокси и ключ попытки). Ожидание:
 * бронь получают ровно столько, сколько осталось мест, остальные — понятный 409 `unavailable`;
 * после оплаты всех броней в учебном банке оплаченных билетов не больше вместимости.
 * Витрина (T-042/T-033) показывает остаток ядра продаж: до гонки — «Осталось 3 билета»,
 * после распродажи — «Билетов нет» на странице спектакля и отказ на странице оформления.
 */

const PARALLEL = 16

type Stock = { capacity: number; sold: number; held: number }

const stock = () =>
  withDb(async (db) => {
    const [row] = await rows<Stock>(
      db,
      sql`select capacity, sold, held from commerce_inventory
          where performance_id = ${PERF_LAST} and ticket_type_id = ${TICKET_TYPE}`,
    )
    return row!
  })

const checkoutBody = (key: string, performanceId = PERF_LAST) => ({
  idempotencyKey: key,
  performanceId,
  selection: { kind: 'tickets', quantities: { [TICKET_TYPE]: 1 } },
  contact: {
    email: uniqueEmail('race'),
    payment: 'card',
    consent: true,
    rulesAccepted: true,
  },
  bonusKopecks: 0,
})

// Без #якоря: повторный переход на тот же адрес с якорем браузер не перезагружает.
const showPage = `/shows/${SHOW_SLUG}?date=${PERF_LAST}`

test('параллельный checkout на последние билеты не продаёт сверх вместимости', async ({
  playwright,
  page,
}) => {
  const before = await stock()
  expect(before.capacity).toBe(LAST_CAPACITY)
  const remaining = before.capacity - before.sold - before.held
  expect(remaining, 'на показе должны оставаться места (свежая база)').toBeGreaterThan(0)

  // До гонки витрина показывает остаток ядра продаж (вместимость урезана до LAST_CAPACITY).
  await page.goto(showPage)
  const session = page.getByLabel('Выбранный показ')
  await expect(session).toContainText(`Осталось ${remaining} билет`)

  // Свой контекст на запрос: разные IP за прокси, без общей cookie-сессии (гости).
  const clients = await Promise.all(
    Array.from({ length: PARALLEL }, () =>
      playwright.request.newContext({
        baseURL: process.env.E2E_BASE_URL,
        extraHTTPHeaders: { ...apiHeaders(), 'x-forwarded-for': randomIp() },
      }),
    ),
  )
  try {
    const bodies = clients.map(() => checkoutBody(randomUUID()))
    const responses = await Promise.all(
      clients.map(async (client, i) => {
        const res = await client.post('/api/checkout', { data: bodies[i] })
        return { i, status: res.status(), body: (await res.json()) as Record<string, unknown> }
      }),
    )
    const placed = responses.filter((r) => r.status === 200)
    const rejected = responses.filter((r) => r.status !== 200)
    expect(placed).toHaveLength(remaining)
    for (const r of rejected)
      expect(r).toMatchObject({ status: 409, body: { code: 'unavailable' } })

    const held = await stock()
    expect(held.sold + held.held).toBe(held.capacity)

    // Повтор успешного оформления с тем же ключом — тот же заказ, второй брони нет.
    const first = placed[0]!
    const replay = await clients[first.i]!.post('/api/checkout', { data: bodies[first.i] })
    expect(replay.status()).toBe(200)
    expect(await replay.json()).toMatchObject({ orderId: first.body.orderId, replay: true })
    expect(await stock()).toEqual(held)

    // Оплачиваем все брони в учебном банке параллельно (как разные покупатели).
    await Promise.all(
      placed.map(async (r) => {
        const payment = new URL(String(r.body.redirectUrl)).searchParams.get('payment')!
        const res = await clients[r.i]!.post('/api/payments/fake/bank', {
          form: { payment, action: 'pay' },
          maxRedirects: 0,
        })
        expect(res.status()).toBe(303)
      }),
    )
    await expect
      .poll(
        () =>
          withDb((db) =>
            rows<{ paid: number }>(
              db,
              sql`select count(*)::int as paid from commerce_orders o
                  where o.status = 'PAID' and o.id in (
                    select order_id from commerce_order_items where performance_id = ${PERF_LAST})`,
            ),
          ),
        { message: 'все брони оплачены' },
      )
      .toEqual([{ paid: before.sold + remaining }])

    const after = await stock()
    expect(after).toEqual({ capacity: LAST_CAPACITY, sold: LAST_CAPACITY, held: 0 })
    const [tickets] = await withDb((db) =>
      rows<{ valid: number }>(
        db,
        sql`select count(*)::int as valid from commerce_tickets
            where performance_id = ${PERF_LAST} and status = 'ISSUED'`,
      ),
    )
    expect(tickets!.valid).toBeLessThanOrEqual(LAST_CAPACITY)
    expect(tickets!.valid).toBe(after.sold)

    // Распродано: новая волна получает только отказы.
    const late = await Promise.all(
      clients
        .slice(0, 5)
        .map((client) => client.post('/api/checkout', { data: checkoutBody(randomUUID()) })),
    )
    for (const res of late) expect(res.status()).toBe(409)

    // Сайт больше не обещает билеты: страница рендерится по запросу с остатком из ядра продаж.
    await page.goto(showPage)
    await expect(session).toContainText('Билетов нет')
    await expect(page.getByText('На этот показ все билеты проданы')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Оформить заказ' })).toHaveCount(0)
    // Старая ссылка на оформление — отказ до формы, а не 409 после ввода почты.
    await page.goto(`/checkout/${PERF_LAST}?tickets=${TICKET_TYPE}:1`)
    await expect(page.getByText('Не удалось восстановить выбор')).toBeVisible()
  } finally {
    await Promise.all(clients.map((c) => c.dispose()))
  }
})

test('один ключ попытки, два параллельных запроса — один заказ', async ({ request }) => {
  // На основном показе (места есть): ключ один, тело одно — как двойной клик «Оплатить».
  const body = checkoutBody(randomUUID(), PERF_MAIN)
  const [a, b] = await Promise.all([
    request.post('/api/checkout', { headers: apiHeaders(), data: body }),
    request.post('/api/checkout', { headers: apiHeaders(), data: body }),
  ])
  expect([a.status(), b.status()]).toEqual([200, 200])
  const [ja, jb] = (await Promise.all([a.json(), b.json()])) as {
    orderId: string
    replay: boolean
  }[]
  expect(ja!.orderId).toBe(jb!.orderId)
  expect([ja!.replay, jb!.replay].filter(Boolean)).toHaveLength(1)
})
