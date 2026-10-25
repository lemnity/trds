# Доменные модули

Бизнес-логика продаж живёт здесь, а не в UI и не в CMS-хуках (architecture.md §4, rules.md §2).

| Модуль | Ответственность |
|---|---|
| `shows` | read models афиши и спектаклей (только опубликованное) |
| `checkout` | клиентская часть покупки: `quoteOrder`, state-machine заказа `transition`, `allocate` (без node/payload) |
| `inventory` | атомарный резерв категорий и мест, `sold + held <= capacity`, синхронизация вместимости; хранилище ядра продаж (`commerce_*`) |
| `orders` | жизненный цикл заказа: оформление с бронью, подтверждение оплаты, отмена, истечение броней, поздняя оплата |
| `payments` | интерфейс `PaymentProvider`; адаптер банка — только в `payments/providers/` |
| `tickets` | выпуск билетов и QR-токен без ПД |
| `refunds` | правила и оркестрация возвратов |
| `loyalty` | bonus ledger, резервы, начисления, сгорание, рефералы |
| `wallet` | bonus ledger, сертификаты и рефералы в PostgreSQL; правила — loyalty |
| `auth` | email OTP и сессии зрителя |
| `leads` | заявки на корпоративы и переходы статусов |
| `email` | шаблоны и `EmailProvider` |
| `consent` | версии документов и журнал согласий |
| `audit` | административный журнал |

Правила импорта (проверяет `tools/boundaries.ts` через `pnpm test`):

- UI (`src/app`, `src/components`) импортирует модуль только через публичный вход `@/modules/<name>`; не импортирует `@/modules/payments` и `@/db`.
- Модули не зависят от Next.js/React и не импортируют UI.
- SDK платёжного провайдера допустим только в `src/modules/payments/providers/`.

## Ядро продаж: `inventory` + `orders` (T-040…T-042, T-048, T-049)

Только сервер. Таблицы — `src/db/schema/commerce.ts` (в схеме Payload через `beforeSchemaInit`).
Хранилище — `CommerceStore` (`inventory/store.ts`): PostgreSQL (`pgStore.ts`) или память
(`memoryStore.ts`, тесты и dev при `ACCOUNTS_STORE=memory`). Каждая операция — одна транзакция
с ограниченным повтором (`withRetry`, deadlock/serialization). Порядок блокировок везде один:
заказ → остатки (показ, категория) → места (показ, место); строки, на которые ссылаются новые
(места), блокируются до вставки ссылающихся — иначе FK `KEY SHARE` даёт deadlock.

```ts
// @/modules/inventory
getInventory(): Promise<InventoryService>
  syncCapacity(spec: CapacitySpec, now?): Promise<SyncResult> // ниже sold+held — BELOW_COMMITTED, ничего не меняется
  availability(performanceId): Promise<{ categories: {ticketTypeId, capacity, sold, held, remaining}[]; unavailableSeatIds: string[] }>
capacityFromPerformance(performance: Performance): CapacitySpec // показ CMS/демо → категории и места схемы зала
// примитивы внутри транзакции заказа:
acquire(tx, lines, { kind: 'hold', holdId, orderId } | { kind: 'sell', orderId }, at) // всё или ничего
release(tx, lines, holdId, at); commit(tx, lines, holdId, orderId, at)

// @/modules/orders
getOrders(): Promise<OrderService>
  placeOrder(input: PlaceOrderInput, now?): Promise<PlaceOrderResult>
    // заказ PENDING_PAYMENT + позиции (снимок цены, доли бонусов) + бронь 15 мин, атомарно;
    // UNAVAILABLE {unavailable[]} | IDEMPOTENCY_CONFLICT; повтор ключа → тот же заказ (duplicate)
  confirmPayment(input: ConfirmPaymentInput, now?): Promise<ConfirmPaymentResult>
    // после проверки платежа у провайдера: PAID + билеты + outbox 'order.paid'; дубль — duplicate;
    // поздняя оплата: остаток заново или NEEDS_REVIEW + outbox 'order.needs_review' (возврат);
    // неверная сумма/валюта — NEEDS_REVIEW; другой платёж оплаченного заказа — DUPLICATE_PAYMENT
  cancelOrder(orderId, { actor, reason }, now?)
  expireHolds(now?, { limit?, verify?, pendingGraceMs? }) // worker; SKIP LOCKED, один заказ — одна транзакция
  recordPaymentEvent(event, now?): Promise<{ duplicate: boolean }> // дедупликация по (provider, eventId)
  getOrder(id): Promise<{ order, items, tickets } | null>
  ticketToken(ticket): string // QR-токен = HMAC(id, версия); в БД только SHA-256
```

Суммы в `placeOrder` считает вызывающий по данным сервера (`quoteOrder`/`quoteSeats` + `applyBonus`);
сервис проверяет целостность (`cash = gross − bonus + fee`, бонусы ≤ билеты) и раскладывает бонусы
по позициям и билетам (`allocate`). Конкурентность на PostgreSQL: `tests/unit/commerce-pg.test.ts`
(запуск с `COMMERCE_PG_URL` на одноразовой базе).

## Покупка и оплата: `payments` + `orders/purchase` (T-043…T-045, T-061, T-062)

`payments` — контракт `PaymentProvider` (доменные типы, копейки), `callProvider` (таймаут 10 с,
3 попытки с backoff; повторяются только `timeout`/`unavailable`) и выбор по `PAYMENT_PROVIDER`
(пусто — оплаты нет; `fake` — учебный банк, не в production). Маршруты к `payments` не обращаются —
use-case `getPurchase()` из `@/modules/orders`:

```ts
checkout({ clientKey, performance, selection, email, customerId, requestedBonusKopecks, method, siteOrigin })
  // цены показа → applyBonus по балансу из базы → placeOrder (ключ checkout:<customer|guest>:<clientKey>)
  // → wallet.spend(spend:<orderId>) → createPayment(payment:<orderId>) вне транзакций → attachPayment
  // → { redirectUrl } | PAYMENT_UNAVAILABLE | UNAVAILABLE | BONUS_CHANGED | ORDER_CLOSED | PAYMENT_FAILED | PAYMENT_RETRY …
orderStatus(orderId, { token | customerId }) // подписанная ссылка возврата; ожидающий — сверка с банком (≤ 1/5 с)
handleNotification(provider, { headers, rawBody }) // подпись → recordPaymentEvent → getPayment → confirmPayment
reconcile() // worker payments.reconcile: ожидающие с платежом, expireHolds({ verify }),
            // releaseSpend истёкших/отменённых, afterPaid оплаченных (accrue 3%, qualifyReferral)
```

Несостоявшийся заказ возвращает бонусы лотами `release` (срок исходного лота); поздняя оплата после
компенсации списывает их заново (`spend:<orderId>:late`), не хватает — `ALERT_PAYMENT_REVIEW`.
Тесты: `tests/unit/purchase.test.ts`, на PostgreSQL — `tests/unit/purchase-pg.test.ts` (`PURCHASE_PG_URL`).
