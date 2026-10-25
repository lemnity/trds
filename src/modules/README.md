# Доменные модули

Бизнес-логика продаж живёт здесь, а не в UI и не в CMS-хуках (architecture.md §4, rules.md §2).

| Модуль | Ответственность |
|---|---|
| `shows` | read models афиши и спектаклей (только опубликованное) |
| `checkout` | сценарий покупки: проверка показа, резерв, создание заказа и платежа |
| `inventory` | атомарный резерв и учёт `sold + held <= capacity` |
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
