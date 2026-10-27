# Админка: оставшиеся разделы — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть разделы админки из `plan/plan-main.md` §7.2, которых ещё нет: журнал аудита, заказы и билеты (с повторной отправкой письма), операционные сигналы, сводка на главной, настройки лояльности и ручная корректировка бонусов.

**Architecture:** Каждый раздел — свой экран Payload (`admin.components.views`) по образцу `/admin/refunds` и `/admin/certificates`: серверный `XView` в `AdminPage` + клиентская панель + REST `/api/cms/...` через `roleGuard` из `src/payload/endpoints/http.ts` с внедряемыми зависимостями для тестов. Запросы к БД — в доменных модулях `src/modules/*` поверх `req.payload.db.drizzle` (как `src/modules/wallet/admin.ts`). Новых таблиц нет: `commerce_audit_log`, `commerce_orders`, `commerce_tickets`, `commerce_outbox`, `commerce_payment_events`, `commerce_refunds`, `commerce_settings`, `wallet_ledger` (kind `manual` уже есть).

**Tech Stack:** Next.js (см. AGENTS.md — читать `node_modules/next/dist/docs/`), Payload CMS 3, Drizzle/PostgreSQL 16, zod, vitest.

**Spec:** `plan/plan-main.md` §7 (роли 7.1, разделы 7.2, «Готово, когда» 7.4), `PRD.md` ADMIN-01…04, `rules.md`.

## Global Constraints

- Права проверяются на сервере (ADMIN-01): каждый endpoint — через `roleGuard`; кнопки/пункты меню скрываются только для удобства.
- MFA: `roleGuard`/`AdminPage` уже требуют пройденный MFA — не обходить.
- Каждое изменяющее действие пишет `commerce_audit_log`: сотрудник, дата, причина, результат (ADMIN-02). Изменения через `writeCmsAudit` (`src/payload/audit.ts`) или `tx.insertAudit` в той же транзакции.
- Секреты интеграций не показываются (ADMIN-04).
- Деньги — копейки, отображение через существующие форматтеры рублей.
- Минимум ПД: в списках почта маскируется (`i***@mail.ru`), полная почта — только в карточке одного заказа/покупателя.
- Домены `src/modules/*` не импортируют Next/React (`tests/unit/architecture-boundaries.test.ts`).
- Импорт доменного модуля в endpoint по умолчанию — динамический (`await import('@/modules/…')`), иначе цикл с `payload.config.ts` (как в `src/payload/components/refunds/endpoints.ts`).
- После добавления компонентов — `pnpm generate:importmap`, файл `src/app/(payload)/admin/importMap.js` коммитится.
- Тексты интерфейса — по-русски, тон `design.md`; красный — только при реальной проблеме.
- «Сегодня» — по `Europe/Moscow`.
- Каждая задача обновляет `tasks.md` (строка соответствующей T-задачи) и `memory.md` одной-двумя строками (правило проекта).
- Проверки перед коммитом: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`. `pnpm build` — в последней задаче.
- PG-тесты: `describe.skipIf(!process.env.ADMIN_PG_URL)`, схема создаётся из `commerceTables`/`walletTables`/`accountsTables` как в `tests/unit/refunds-pg.test.ts`. Если docker доступен — прогнать: `docker run -d -p 127.0.0.1:55440:5432 -e POSTGRES_PASSWORD=x postgres:16.15-alpine` и `ADMIN_PG_URL=postgres://postgres:x@127.0.0.1:55440/postgres pnpm vitest run <file>`; если нет — сказать в отчёте, что PG-тесты пропущены.

## Rulings (решения без заказчика)

- **Чеки (54-ФЗ) исключены**: хранилища чеков нет, схема не выбрана (T-002). В сигналах и сводке — строка «Чеки — появятся после подключения кассы», без запросов.
- **Повторная отправка письма с билетами** — новая строка outbox `order.paid` с ключом `order.paid:<orderId>:resend:<n>` (n = число прошлых повторов + 1); не более одной незавершённой повторной отправки на заказ.
- **Настройки лояльности** — `commerce_settings`, ключ `loyalty_rules`, по образцу `src/modules/refunds/policy.ts`; действуют на будущие операции, прошлые начисления не пересчитываются.
- **Ручная корректировка** — `wallet_ledger.kind='manual'`; плюс — лот со сроком `bonusExpiresAt`, минус — списание из живых лотов, не больше доступного баланса; причина — в `commerce_audit_log.reason`.
- **Роли:** заказы и сигналы — `['admin','cashier']`; повтор письма — `['admin','cashier']`; повтор outbox, аудит, лояльность — `['admin']`.

## Review Focus

- Поиск заказа по почте в другом регистре/с пробелами (`  Ivan@Mail.RU `) — находит заказ (нормализация trim+lowercase). Тест — Task 2.
- Двойной клик «Отправить билеты ещё раз» — вторая отправка отклоняется `resend_pending`, письмо одно. Тест — Task 3.
- Повтор outbox-строки, которую worker уже взял/завершил (статус не `dead`) — 409 `not_dead`, строка не трогается. Тест — Task 4.
- Ручное списание больше доступного баланса — 422 `insufficient_balance`, ledger без изменений. Тест — Task 7.
- Пустое/частичное значение `loyalty_rules` в `commerce_settings` — недостающие поля берутся из `LOYALTY_RULES`, а не NaN. Тест — Task 6.

---

### Task 1: Журнал аудита (`/admin/audit`) и общий список пунктов меню

**Files:**
- Create: `src/modules/audit/read.ts`, `src/modules/audit/index.ts`
- Create: `src/payload/endpoints/audit.ts`
- Create: `src/payload/components/audit/AuditView.tsx`, `src/payload/components/audit/AuditPanel.tsx`
- Modify: `src/payload/components/AdminNavLinks.tsx` (список разделов с ролями), `src/payload.config.ts` (view + endpoints)
- Test: `tests/unit/admin-audit.test.ts` (endpoints, deps внедрены), `tests/unit/admin-audit-pg.test.ts` (запрос)

**Interfaces:**
- Produces:
  - `type AuditQuery = { entity?: string; entityId?: string; actor?: string; action?: string; from?: Date; to?: Date; page: number }`
  - `type AuditRow = { id: string; at: Date; actor: string; action: string; entity: string; entityId: string | null; reason: string | null; result: string | null }`
  - `listAudit(db: PgDb, q: AuditQuery): Promise<{ rows: AuditRow[]; hasMore: boolean }>` — сортировка `at desc`, `AUDIT_PAGE_SIZE = 50`, `hasMore` через выборку 51 строки. (`PgDb` — тип drizzle-базы, который уже использует `src/modules/wallet/admin.ts`.)
  - `AUDIT_ROLES = ['admin'] as const`; `auditEndpoints(overrides?: Partial<AuditDeps>): Endpoint[]` — `GET /cms/audit?entity=&entityId=&actor=&action=&from=&to=&page=`.
  - `AdminNavLinks`: массив `ADMIN_SECTIONS: { path: string; label: string; roles: StaffRole[] }[]`, пункт виден при `user.systemAdmin` или `roles.includes(user.role)`. Существующие пункты: `/leads` «Корпоративы (канбан)» `['admin']`, `/certificates` «Подарочные сертификаты» `['admin']`; добавить `/audit` «Журнал действий» `['admin']`. Следующие задачи добавляют сюда свои пункты. `RefundsNavLink` не трогать.

- [ ] **Step 1: failing tests.** Endpoint (helpers как в `tests/unit/cms-admin-endpoints.test.ts`): кассир → 403 `forbidden`; админ без MFA → 403 `mfa_required`; админ → 200, параметры `from`/`to` (ISO-даты) и `page` переданы в `list` разобранными; некорректная дата → 400 `bad_request`. PG: три строки с разными `entity`/`at` → фильтр по `entity` возвращает только свои, порядок `at desc`; 51 строка → `hasMore: true`, 50 строк в `rows`.
- [ ] **Step 2:** `pnpm vitest run admin-audit` — FAIL (модуль не найден).
- [ ] **Step 3:** реализовать `listAudit`, endpoints, `AuditView` (`AdminPage roles={AUDIT_ROLES} path="/audit"`), `AuditPanel` (фильтры: раздел, сотрудник, действие, даты; таблица: время по Москве, сотрудник, действие, объект, причина, результат; «Ещё»). Сотрудник `admin-users:<id>` показывать почтой: endpoint дополняет строки почтами через `req.payload.find({collection:'admin-users', where:{id:{in}}})`.
- [ ] **Step 4:** `pnpm generate:importmap`; `pnpm vitest run admin-audit` — PASS; полный набор проверок из Global Constraints — PASS.
- [ ] **Step 5:** обновить `tasks.md` (T-023/ADMIN-02), `memory.md`; commit `feat(admin): audit log view`.

### Task 2: Заказы — поиск и карточка (`/admin/orders`)

**Files:**
- Create: `src/modules/orders/admin.ts` (экспорт через `src/modules/orders/index.ts`)
- Create: `src/payload/endpoints/orders.ts`
- Create: `src/payload/components/orders/OrdersView.tsx`, `OrdersPanel.tsx`
- Modify: `AdminNavLinks.tsx` (пункт `/orders` «Заказы и билеты» `['admin','cashier']`), `src/payload.config.ts`
- Test: `tests/unit/admin-orders.test.ts`, `tests/unit/admin-orders-pg.test.ts`

**Interfaces:**
- Consumes: `ADMIN_SECTIONS` (Task 1).
- Produces:
  - `maskEmail(email: string): string` — `ivan@mail.ru` → `i***@mail.ru`; локальная часть из 1 символа → `*@mail.ru`.
  - `findOrdersForStaff(db: PgDb, query: string, limit = 20): Promise<StaffOrderSummary[]>` — если `query.trim().toUpperCase()` совпадает с `^TRD-[A-Z0-9]{8}$` — по номеру; иначе по `lower(email) = lower(trim(query))`; сортировка `created_at desc`. `StaffOrderSummary = { id; number; status; createdAt; paidAt; emailMasked; grossKopecks; cashKopecks; bonusKopecks; ticketCount }`.
  - `orderDetailForStaff(db: PgDb, number: string): Promise<StaffOrderDetail | null>` — заказ (с полной почтой), позиции (снапшоты названия/даты/места/цены), билеты (номер, статус, цена, `issuedAt`, `refundedAt`; без `token_hash`), платёжные события (`eventType`, `receivedAt`, `processedAt`, `result`; без `payload`), возвраты (статус, суммы, причина, `requestedBy`), письма — строки outbox с `aggregate_id = order.id` (`kind`, `status`, `attempts`, `lastError`, `createdAt`, `processedAt`).
  - `ORDERS_ROLES = ['admin','cashier'] as const`; `orderEndpoints(overrides?)`: `GET /cms/orders?q=` (пустой/короче 3 символов → 400 `query_too_short`), `GET /cms/orders/:number` (404 `not_found`).
  - Просмотр карточки пишет аудит `cms.order.view` (result `ok`, `entityId` = номер) — доступ к ПД журналируется.

- [ ] **Step 1: failing tests.** `maskEmail` (обычный, однобуквенный); endpoint: editor → 403, кассир → 200, `q='ab'` → 400 `query_too_short`, карточка неизвестного номера → 404, карточка → аудит `cms.order.view`. PG: заказ с почтой `Ivan@Mail.ru` находится по `'  ivan@MAIL.RU '`; по номеру в нижнем регистре; в карточке нет полей `tokenHash`/`payload`; список отдаёт `emailMasked`, не `email`.
- [ ] **Step 2:** `pnpm vitest run admin-orders` — FAIL.
- [ ] **Step 3:** реализовать; панель: поле поиска (начальное значение — параметр `q` из URL), список, карточка с разделами «Состав», «Билеты», «Оплата», «Возвраты», «Письма»; в карточке — ссылка на `/admin/refunds`.
- [ ] **Step 4:** importmap; тесты и проверки — PASS.
- [ ] **Step 5:** `tasks.md`, `memory.md`; commit `feat(admin): orders search and detail`.

### Task 3: Повторная отправка письма с билетами

**Files:**
- Modify: `src/modules/orders/admin.ts`, `src/payload/endpoints/orders.ts`, `src/payload/components/orders/OrdersPanel.tsx`, `docs/admin-guide.md` §10
- Test: `tests/unit/admin-orders.test.ts`, `tests/unit/admin-orders-pg.test.ts`

**Interfaces:**
- Consumes: `orderEndpoints` (Task 2); `EMAIL_EVENT_KINDS.orderPaid` (`src/modules/tickets/notifications.ts`); форма payload строки `order.paid` — как её вставляет `src/modules/orders/service.ts` (~строка 196).
- Produces:
  - `resendTicketEmail(db: PgDb, input: { number: string; actor: string; reason: string; now: Date }): Promise<{ outboxId: string }>` — в одной транзакции: заказ `PAID` или `PARTIALLY_REFUNDED`, иначе ошибка `not_paid`; есть строка outbox с `dedupe_key like 'order.paid:<id>:resend:%'` и `status in ('pending','processing')` → ошибка `resend_pending`; вставка строки `kind='order.paid'`, `dedupe_key='order.paid:<id>:resend:<n>'`, `next_attempt_at=now`; аудит `cms.order.resend_tickets` с причиной.
  - `POST /cms/orders/:number/resend` body `{ reason }` (короче 3 символов → 400 `reason_required`); `not_paid` → 409; `resend_pending` → 409 «Письмо уже в очереди».

- [ ] **Step 1: failing tests.** Endpoint: cross-origin POST → 403; без причины → 400; кассир → 200, сервис вызван с `actor` `admin-users:<id>`. PG: оплаченный заказ → строка outbox `...:resend:1`, аудит с причиной; повтор сразу → `resend_pending`, строк одна; после перевода первой в `done` → `...:resend:2`; заказ `EXPIRED` → `not_paid`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** реализовать; кнопка «Отправить билеты ещё раз» в карточке с полем причины и подтверждением.
- [ ] **Step 4:** PASS + проверки.
- [ ] **Step 5:** `tasks.md` (T-047), `memory.md`, `docs/admin-guide.md` §10 (кнопка теперь есть); commit `feat(admin): resend ticket email`.

### Task 4: Операционные сигналы (`/admin/ops`) и повтор писем из outbox

**Files:**
- Create: `src/modules/ops/signals.ts`, `src/modules/ops/index.ts`
- Create: `src/payload/endpoints/ops.ts`, `src/payload/components/ops/OpsView.tsx`, `OpsPanel.tsx`
- Modify: `AdminNavLinks.tsx` (пункт `/ops` «Сигналы» `['admin','cashier']`), `src/payload.config.ts`, `docs/admin-guide.md` §9, `docs/runbook.md` §3
- Test: `tests/unit/admin-ops.test.ts`, `tests/unit/admin-ops-pg.test.ts`

**Interfaces:**
- Consumes: `PENDING_PAYMENT_GRACE_MS` (`src/modules/orders/service.ts`), `OUTBOX_STUCK_AFTER_MS` (`src/jobs/tasks/outbox-monitor.ts` — если импорт из jobs в модуль нарушает границы, перенести константу в `src/modules/email/outbox.ts`, а в jobs импортировать оттуда), `maskEmail` (Task 2).
- Produces:
  - `type OpsSignals = { stuckPayments: OpsOrder[]; needsReview: OpsOrder[]; unprocessedEvents: number; deadEmails: OpsOutbox[]; delayedEmails: number; refundsNeedReview: OpsRefund[] }`; `OpsOrder = { number; status; createdAt; holdUntil; reviewReason; emailMasked; cashKopecks }`; `OpsOutbox = { id; kind; aggregateId; orderNumber: string | null; attempts; lastError; createdAt }`; `OpsRefund = { id; orderNumber; status; lastError; createdAt }`.
  - `opsSignals(db: PgDb, now: Date): Promise<OpsSignals>` — зависший платёж: `PENDING_PAYMENT` и `hold_until < now - PENDING_PAYMENT_GRACE_MS`; `needsReview`: `NEEDS_REVIEW`; `unprocessedEvents`: `processed_at is null and received_at < now - 10 мин`; `deadEmails`: `status='dead'`; `delayedEmails`: `processed_at is null and status <> 'dead' and created_at < now - OUTBOX_STUCK_AFTER_MS`; `refundsNeedReview`: `MANUAL_REVIEW` или `FAILED`. Списки — до 50 строк.
  - `retryOutbox(db: PgDb, input: { id: string; actor: string; reason: string; now: Date }): Promise<void>` — `update … set status='pending', attempts=0, next_attempt_at=now, last_error=null where id=$ and status='dead'`; 0 строк → ошибка `not_dead`; аудит `cms.outbox.retry`.
  - `OPS_ROLES = ['admin','cashier']`, `OPS_RETRY_ROLES = ['admin']`; `GET /cms/ops`, `POST /cms/ops/outbox/:id/retry` `{ reason }` (`not_dead` → 409).

- [ ] **Step 1: failing tests.** Endpoint: кассир GET → 200, кассир retry → 403 + аудит `denied`; админ retry → 200. PG: заказ `PENDING_PAYMENT` с `hold_until` 30 мин назад → в `stuckPayments`, с `hold_until` 1 мин назад → нет; `dead`-строка outbox → в `deadEmails` с `orderNumber`; retry `dead` → `pending`, `attempts=0`; retry `done`-строки → `not_dead`, строка без изменений.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** реализовать; панель — блоки «Зависшие оплаты», «Требуют проверки», «Письма не ушли», «Возвраты требуют внимания», «Чеки — появятся после подключения кассы»; номера заказов ведут на `/admin/orders?q=<номер>`; пустой блок — спокойный текст «Всё в порядке».
- [ ] **Step 4:** importmap; PASS + проверки.
- [ ] **Step 5:** `tasks.md` (T-045/T-047), `memory.md`, `docs/admin-guide.md` §9 (сигналы теперь видны в админке), `docs/runbook.md` §3; commit `feat(admin): ops signals and outbox retry`.

### Task 5: Сводка на главной админки

**Files:**
- Create: `src/modules/ops/sales.ts` (экспорт через `src/modules/ops/index.ts`)
- Create: `src/payload/components/dashboard/DashboardSummary.tsx` (серверный компонент)
- Modify: `src/payload.config.ts` (`admin.components.beforeDashboard`)
- Test: `tests/unit/admin-dashboard.test.ts`, `tests/unit/admin-ops-pg.test.ts`

**Interfaces:**
- Consumes: `opsSignals` (Task 4), `hasRole`/`activeStaff` (`src/payload/access/roles.ts`).
- Produces:
  - `moscowDayStart(now: Date): Date` — начало суток по `Europe/Moscow` (UTC+3 круглый год).
  - `salesToday(db: PgDb, now: Date): Promise<{ orders: number; tickets: number; cashKopecks: number; bonusKopecks: number }>` — заказы с `paid_at >= moscowDayStart(now)` в статусах `PAID`/`PARTIALLY_REFUNDED`/`REFUNDED`.
  - `DashboardSummary` — для admin/cashier с MFA: «Продано сегодня: N заказов, M билетов, X ₽ (+Y ₽ бонусами)»; счётчики сигналов со ссылкой на `/admin/ops`; ненулевые — красным, нули — нейтрально; редактору — `null`. Ошибка БД → строка «Сводка недоступна», страница не падает.

- [ ] **Step 1: failing tests.** `moscowDayStart(new Date('2026-10-27T20:59:00Z'))` → `2026-10-26T21:00:00Z`; `moscowDayStart(new Date('2026-10-27T21:00:00Z'))` → `2026-10-27T21:00:00Z`. PG: заказ, оплаченный вчера в 23:30 МСК, не входит; сегодня в 00:10 МСК — входит; `EXPIRED` — не входит.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** реализовать.
- [ ] **Step 4:** importmap; PASS + проверки.
- [ ] **Step 5:** `tasks.md`, `memory.md`; commit `feat(admin): dashboard summary`.

### Task 6: Настройки лояльности в админке

**Files:**
- Create: `src/modules/loyalty/settings.ts` (экспорт через `src/modules/loyalty/index.ts`)
- Create: `src/payload/endpoints/loyalty.ts`, `src/payload/components/loyalty/LoyaltyView.tsx`, `LoyaltyPanel.tsx`
- Modify: `src/modules/wallet/service.ts`, `src/modules/wallet/index.ts`, `src/jobs/main.ts` (источник настроек); `src/app/api/loyalty/summary/route.ts` и UI, берущий `LOYALTY_RULES` (`src/components/checkout/CheckoutBonus.tsx`, `src/components/account/BonusSection.tsx`, `src/components/account/loyalty-view.ts`), а также расчёт бонусов при оформлении заказа, если он вызывает `applyBonus`/`maxBonusSpend`/`accrualFor` с настройками по умолчанию; `AdminNavLinks.tsx` (`/loyalty` «Бонусы» `['admin']`); `src/payload.config.ts`
- Test: `tests/unit/loyalty-settings.test.ts`; существующие `wallet.test.ts`, `account-loyalty.test.ts`, `loyalty.test.ts` должны остаться зелёными

**Interfaces:**
- Consumes: `LoyaltySettings`, `LOYALTY_RULES` (`src/modules/loyalty/rules.ts`); образец — `src/modules/refunds/policy.ts` и `RefundService.updatePolicy`.
- Produces:
  - `LOYALTY_SETTINGS_KEY = 'loyalty_rules'`; `loyaltySettingsSchema` (zod, целые): `accrualBasisPoints` 0…10000, `maxSpendBasisPoints` 0…10000, `bonusLifetimeDays` 1…3650, `referralGroupSize` 1…20, `referralRewardKopecks` 0…10_000_000.
  - `parseLoyaltySettings(value: unknown): LoyaltySettings` — поле невалидно/отсутствует → значение из `LOYALTY_RULES`.
  - `loadLoyaltySettings(db: PgDb): Promise<LoyaltySettings>`; `updateLoyaltySettings(db: PgDb, input: { value: LoyaltySettings; actor: string; reason: string }): Promise<LoyaltySettings>` — upsert + аудит `loyalty_rules.updated` (result — JSON «было → стало») в одной транзакции.
  - `createWalletService` принимает `settings: () => Promise<LoyaltySettings>` (вместо объекта); `getWallet` и `src/jobs/main.ts` передают `() => loadLoyaltySettings(db)`; тесты — `async () => LOYALTY_RULES`.
  - `/api/loyalty/summary` дополнительно отдаёт `rules: LoyaltySettings`; кабинет и оформление берут правила из ответа API/пропсов сервера; `LOYALTY_RULES` в UI остаётся только для демо-режима превью.
  - `GET /cms/loyalty/settings`, `POST /cms/loyalty/settings` `{ value, reason }` (невалидно → 400 с полем ошибки).

- [ ] **Step 1: failing tests.** `parseLoyaltySettings({ accrualBasisPoints: 500 })` → 500 и остальные из `LOYALTY_RULES`; `parseLoyaltySettings(null)` → `LOYALTY_RULES`; `loyaltySettingsSchema` отклоняет `maxSpendBasisPoints: 20000`; endpoint: кассир POST → 403, админ → 200 и вызов с причиной; wallet: с настройкой `accrualBasisPoints: 500` начисление за 1000 ₽ оплаты деньгами = 50 ₽.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** реализовать; панель — поля в человеческих единицах (проценты, дни, рубли), причина обязательна, предупреждение «Действует для новых операций; прошлые начисления не меняются».
- [ ] **Step 4:** importmap; PASS + проверки.
- [ ] **Step 5:** `tasks.md` (T-060…T-064), `memory.md`, `docs/admin-guide.md`; commit `feat(admin): editable loyalty settings`.

### Task 7: Баланс покупателя и ручная корректировка

**Files:**
- Modify: `src/modules/wallet/service.ts` (+ pg-реализация `WalletTx` при необходимости), `src/modules/wallet/admin.ts`
- Modify: `src/payload/endpoints/loyalty.ts`, `src/payload/components/loyalty/LoyaltyPanel.tsx`
- Modify (финал): `docs/admin-guide.md`, `plan/plan-main.md` §7 и сводка §1
- Test: `tests/unit/wallet.test.ts`, `tests/unit/admin-loyalty.test.ts`

**Interfaces:**
- Consumes: `WalletService.summary`, путь `spend` (`planSpend`/`insertAllocations`), `bonusExpiresAt`; настройки из Task 6; `maskEmail` (Task 2).
- Produces:
  - `WalletService.adjust(input: { customerId: string; amountKopecks: number; actor: string; reason: string; idempotencyKey: string; now: Date }): Promise<{ balanceKopecks: number }>` — `amountKopecks` ≠ 0 и |сумма| ≤ 10_000_000, иначе `invalid_amount`; плюс — запись `manual` лотом со сроком `bonusExpiresAt(now, settings)`; минус — списание из живых лотов (как `spend`, раньше сгорающие первыми), больше доступного → `insufficient_balance`; `source_ref = 'manual:' + actor`; аудит `wallet.manual_adjust` с причиной в той же транзакции; повтор того же `idempotencyKey` → тот же результат без второй записи.
  - `findCustomerByEmail(db: PgDb, email: string): Promise<{ id: string; email: string; name: string | null } | null>` (trim+lowercase) в `src/modules/wallet/admin.ts`.
  - `GET /cms/loyalty/customer?email=` → `{ customer, balanceKopecks, expiring, history }` (404 `not_found`; просмотр пишет аудит `cms.customer.view`); `POST /cms/loyalty/adjust` `{ email, amountKopecks, reason, idempotencyKey }` (`insufficient_balance` → 422, `invalid_amount` → 400, нет причины → 400 `reason_required`).

- [ ] **Step 1: failing tests.** wallet (в памяти, как `wallet.test.ts`): +500 ₽ → баланс +500, запись `manual` со сроком; −300 ₽ при балансе 500 → 200; −600 ₽ при балансе 500 → `insufficient_balance`, записей не добавилось; повтор ключа → одна запись; 0 → `invalid_amount`. Endpoint: кассир → 403; админ без причины → 400 `reason_required`; неизвестная почта → 404.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** реализовать; панель: поиск по почте, баланс, сгорающие, история (тип, сумма, дата, срок), форма «Начислить / Списать» (сумма в рублях, причина, подтверждение); `idempotencyKey` — `crypto.randomUUID()` при открытии формы.
- [ ] **Step 4:** PASS + проверки + `pnpm build`.
- [ ] **Step 5:** `tasks.md`, `memory.md`, `docs/admin-guide.md`, `plan/plan-main.md` (§7 и сводка); commit `feat(admin): customer bonus balance and manual adjustment`.
