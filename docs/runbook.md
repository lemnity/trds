# Runbook — эксплуатация «Турдус»

Логи, мониторинг, фоновые задачи, резервные копии и восстановление (T-014, T-015, T-072).
Команды — из каталога проекта на сервере, где лежат `docker-compose.yml` и `.env`.

## 1. Компоненты

| Сервис compose | Что делает | Где состояние |
|---|---|---|
| `app` | Next.js + Payload, `/api/health` | читает том `ops-state` (только чтение) |
| `worker` | фоновые задачи, heartbeat | пишет `ops-state/worker-heartbeat.json` |
| `backup` | ежедневный `scripts/backup.sh` | копии — том `backups`; итог — `ops-state/backup-status.json` |
| `postgres` | БД, только внутренняя сеть | том `postgres-data` |
| `caddy` | HTTPS, единственные открытые порты | тома `caddy-*` |

## 2. Логи

Все сервисы пишут **JSON-строки** в stdout/stderr контейнера: `{"ts","level","event","service",…}`.
Хранит их Docker (`docker compose logs`). Внешнего сборщика логов пока нет — выбрать вместе с хостингом.

```sh
docker compose logs -f app worker backup                       # поток
docker compose logs --since 1h app | grep '"level":"error"'     # ошибки за час
docker compose logs --since 24h | grep '"event":"alert"'        # все сигналы за сутки
docker compose logs app | grep '"correlationId":"<id>"'         # один запрос
docker compose logs --since 1h app | sed 's/^[^{]*//' | jq 'select(.level=="error")'   # с jq
```

- Уровень — `LOG_LEVEL` (`debug|info|warn|error`, по умолчанию `info`).
- Маскирование (`src/lib/log.ts`): поля с паролями/токенами/кодами/cookie/хешами — `[redacted]`;
  поля email/телефон/ФИО/адрес/IP — `[pii]`; почта, телефоны, коды «код 123456», `Bearer …`,
  пароль в строке подключения и длинные токены в любых строках вырезаются; ошибки — только тип и код.
  Логировать надо безопасные идентификаторы: id заказа, `correlationId`.
- **Correlation ID.** API-маршрут, обёрнутый `withCorrelation` (`src/lib/correlation.ts`), берёт
  `x-request-id` из запроса (или создаёт UUID), пишет его в каждую строку лога и возвращает в ответе
  тем же заголовком и в теле ошибки `{code, message, correlationId}`. Пользователь/поддержка
  сообщают id — по нему ищется запрос. Сейчас подключено в `/api/health`.
  - **Владельцам маршрутов** (`/api/auth/**`, `/api/leads`, `/api/loyalty/**`, checkout, webhook):
    перевести обработчики на `withCorrelation` + `apiError` и логировать через `ctx.log`
    вместо `console.error`.
  - Caddy заголовок пока не ставит; при желании — `request_header X-Request-Id {http.request.uuid}`
    в `Caddyfile`, тогда id совпадёт с access-логом Caddy.

## 3. Мониторинг

### `/api/health`

```sh
curl -s https://<домен>/api/health
# {"status":"ok","checks":{"database":"ok","worker":"ok","backup":"ok"}}
```

| `status` | HTTP | Значение |
|---|---|---|
| `ok` | 200 | всё в порядке |
| `degraded` | 200 | сайт работает, но устарел heartbeat worker или бэкап — смотреть `checks` |
| `error` | 503 | недоступна БД — сайт не работает |

Наружу отдаются только `ok`/`error` по проверкам, без текста ошибок. Пороги:
`WORKER_HEARTBEAT_MAX_AGE_MS` (15 минут = 3 такта worker; при изменении `WORKER_TICK_MS` поменять
тоже) и `BACKUP_MAX_AGE_HOURS` (26 часов). Healthcheck контейнера `app` реагирует только на 503.

**Внешний монитор** (ещё не выбран, нужен до запуска): опрашивать `/api/health` раз в 1–5 минут
и оповещать при `status != "ok"`, ошибке TLS или таймауте. Отдельно — свободное место на диске
сервера (порог 20 %): `df -h /var/lib/docker`.

### Сигналы (стабильные коды)

Каждый сигнал — строка `"level":"error","event":"alert","alert":"<КОД>"`. Коды не переименовывать.

| Код | Кто пишет | Значение |
|---|---|---|
| `ALERT_WORKER_STALE` | app (при опросе `/api/health`, не чаще раза в 15 мин) | heartbeat worker старше порога |
| `ALERT_OUTBOX_STUCK` | worker, задача `outbox.monitor` | необработанные события outbox старше 30 мин |
| `ALERT_BACKUP_FAILED` | `scripts/backup.sh` (`step` — на каком шаге); app — если бэкап устарел (`source: health`) | бэкап не создан |
| `ALERT_JOB_FAILED` | worker | задача упала (тип ошибки в `error`), повторится на следующем такте |
| `ALERT_PAYMENT_REVIEW` | app, worker (оплата, возвраты) | заказ или возврат требует человека: поздняя оплата без мест, неверная сумма, нехватка бонусов, возврат на ручном разборе (что делать кассе — `docs/admin-guide.md` §8–9) |

## 4. Фоновые задачи (worker)

Такт — `WORKER_TICK_MS` (5 минут). Каждая задача идемпотентна, ошибка одной не останавливает другие.

| Задача | Расписание | Что делает |
|---|---|---|
| `wallet.expire` | раз в час | сгорание бонусных лотов: `WalletService.expireDue` (ключ `expire:<лот>`, SKIP LOCKED) |
| `accounts.cleanup` | раз в час | удаляет коды входа через сутки после истечения и сессии через 30 дней после истечения/отзыва (пачками по 1000) |
| `outbox.monitor` | каждый такт | сигнал `ALERT_OUTBOX_STUCK`; пока таблицы `commerce_outbox` в БД нет — ничего не делает |

Сроки хранения в `accounts.cleanup` — консервативные значения до утверждения политики театром
(`src/jobs/tasks/accounts-cleanup.ts`). Heartbeat: `docker compose exec app cat /app/state/worker-heartbeat.json`
— время последнего такта и итог (`ok`) последнего запуска каждой задачи.

## 5. Разбор инцидентов

### `ALERT_WORKER_STALE` / `checks.worker = "error"`
1. `docker compose ps worker` — запущен ли; `docker compose logs --since 1h worker | tail -50`.
2. Нет строк `worker.heartbeat` — процесс завис: задача висит на БД или внешнем API.
   `docker compose restart worker` (задачи идемпотентны — повтор безопасен).
3. Падает при старте (`Invalid server environment`) — проверить `.env`.
4. После восстановления `checks.worker` вернётся в `ok` в течение одного такта.

### `ALERT_JOB_FAILED`
Единичный — временная ошибка (БД перезапускалась). Повторяется каждый такт — смотреть `error`
(тип ошибки) и `job`, воспроизводить на копии БД; для `accounts.cleanup`/`wallet.expire` данные
не портятся: транзакция откатывается.

### `ALERT_OUTBOX_STUCK`
Письма/возвраты не уходят. Проверить, жив ли worker (выше) и нет ли `ALERT_JOB_FAILED` у задачи
outbox; затем — доступность провайдера почты/банка. Сценарии «платёж списан, билет не пришёл»,
«дубли вебхука», «возврат завис», «чек не сформирован» дописываются вместе с T-045…T-048.

### `ALERT_BACKUP_FAILED` / `checks.backup = "error"`
1. `docker compose logs --since 48h backup | grep -E 'alert|backup\.'` — поле `step`:
   `counts`/`pg_dump` — нет доступа к БД (пароль, БД лежит); `media` — нет каталога; `lock` —
   предыдущий бэкап не завершился или упал до снятия блокировки.
2. Зависший lock: если бэкап сейчас точно не идёт (`docker compose top backup` — нет `pg_dump`),
   `docker compose exec backup rmdir /backups/.lock`.
3. Место: `docker compose exec backup df -h /backups`.
4. Повторить вручную (§6) и убедиться, что `/api/health` снова `ok`.

### Нет места на диске
`df -h`; `docker system df`; старые копии — `docker compose exec backup ls -la /backups`
(уменьшить `BACKUP_RETENTION_DAYS`); старые образы — `docker image prune`. Не удалять том `postgres-data`.

## 6. Резервные копии (T-014)

- **Что:** `pg_dump` в custom-формате (сжатие 6, без владельцев и прав) + архив медиа
  (`MEDIA_DIR`; пока медиа Payload не настроены (T-020) — пропускается с `backup.media_skipped`).
  Рядом — `counts.tsv` (точное число строк каждой таблицы), `manifest.json`, `SHA256SUMS`.
- **Когда:** ежедневно в `BACKUP_AT` по UTC (по умолчанию 00:30 UTC = 03:30 МСК), сервис `backup`.
- **Где:** том `backups`, каталоги `trds-<UTC-время>`; хранятся `BACKUP_RETENTION_DAYS` дней (14),
  последняя успешная не удаляется никогда.
- **Внешняя копия — ЗАГЛУШКА.** Провайдер S3 в РФ не выбран; `BACKUP_OFFSITE_TARGET` только
  логируется (`backup.offsite_skipped`). До запуска: выбрать хранилище, включить шифрование на
  стороне клиента (копия содержит ПД), добавить загрузку и сеть `edge` сервису `backup`, хранить
  ключи не только у исполнителя (architecture.md §15). Пока — копировать вручную (ниже).

```sh
# Внеплановая копия (например, перед миграцией):
docker compose run --rm --entrypoint bash backup /scripts/backup.sh
# Список и итог последней:
docker compose exec backup ls -la /backups
docker compose exec app cat /app/state/backup-status.json
# Забрать копии на другую машину:
docker compose run --rm --no-deps --entrypoint tar backup -C /backups -cf - . > trds-backups.tar
```

Вне compose (`pnpm backup -- --dest DIR --media-dir DIR`) скрипт берёт подключение из `PG*`
или `DATABASE_URL`; нужны `pg_dump`/`psql` 16.

## 7. Восстановление

`scripts/restore.sh` проверяет `SHA256SUMS`, просит подтверждение (ввести имя БД; в скриптах — `--yes`),
отказывается писать в непустую БД без `--clean`, восстанавливает одной транзакцией
(`--exit-on-error --single-transaction`), сверяет число строк каждой таблицы с `counts.tsv` и число
файлов медиа с манифестом. Любое расхождение — exit 1.

### На новом сервере (потеря сервера)
1. Развернуть проект и `.env` по README (секреты — из хранилища театра), **не** запуская app/worker:
   `docker compose up -d postgres`.
2. Скопировать каталог копии `trds-<время>` на сервер, например в `./restore/`.
3. Восстановить из одноразового контейнера во внутренней сети:
   ```sh
   docker compose run --rm --no-deps -v "$PWD/restore:/restore:ro" --entrypoint bash backup \
     /scripts/restore.sh --from /restore/trds-<время> --target-db trds --yes
   ```
   (`PG*` берутся из окружения сервиса `backup`.) Медиа — `--media-dest <каталог>`, затем
   перенести в хранилище медиа.
4. `docker compose up -d` → `/api/health` = `ok`; проверить афишу, вход в кабинет, баланс бонусов.

### На том же сервере (порча данных)
1. Остановить запись: `docker compose stop app worker`.
2. Сделать копию текущего состояния (§6) — для разбора.
3. Восстановить с `--clean` (удаляет существующие таблицы!):
   `docker compose run --rm --no-deps --entrypoint bash -v "$PWD/restore:/restore:ro" backup /scripts/restore.sh --from /restore/trds-<время> --target-db trds --clean`
   — без `--yes` скрипт спросит имя БД.
4. `docker compose start app worker`. Всё, что было после времени копии, потеряно (RPO) —
   сверить оплаты с личным кабинетом банка.

## 8. Учение восстановления (T-072)

**Проведено локально 25.10.2026** (MacBook, Apple Silicon, Docker Desktop; PostgreSQL 16.15 из
того же образа, что в compose). **На продуктивном сервере повторить до запуска** и затем раз в
квартал, записывая цифры сюда.

### Процедура
1. Отдельный проект compose `trds-drill` (свои тома и сеть) с опубликованным на 127.0.0.1 портом
   postgres — через override-файл; продуктивные сервисы не затрагиваются.
2. Схема: `NODE_ENV=development DATABASE_URL=… PAYLOAD_SECRET=… pnpm drill:schema` (push Payload,
   только для localhost) → 20 таблиц.
3. Данные: `psql … -v scale=1 -f scripts/drill/seed.sql` (синтетика `@example.invalid`).
4. Прогон worker (бандл esbuild, как в Dockerfile) на учебной БД: `wallet.expire` сжёг 3000 лотов,
   повтор — 0 (идемпотентно); `accounts.cleanup` удалил 10 000 кодов и 2 500 сессий; heartbeat-файл
   обновлялся каждый такт.
5. Бэкап сервисом `backup` (`docker compose -p trds-drill run --rm --entrypoint bash backup /scripts/backup.sh`)
   с каталогом медиа (11 портретов).
6. После бэкапа добавлена строка-маркер — проверка RPO.
7. Восстановление «на новом сервере»: новый пустой контейнер PostgreSQL, копия вынута из тома
   `backups` (`tar`), `scripts/restore.sh --yes --media-dest …`. Повторно — `--clean` внутри образа
   postgres (busybox) поверх уже восстановленной БД.
8. Сверка: `counts.tsv` по всем 20 таблицам; сумма `wallet_ledger.amount_kopecks`; md5 по
   `accounts_customers` и остаткам лотов; sha256 каждого файла медиа.

### Результаты

| Объём | Строк | db.dump | Бэкап | Новый PG готов | Получение копии | Restore + сверка | Итого RTO (тех.) |
|---|---|---|---|---|---|---|---|
| scale=1 | 71 001 | 3,4 МБ | 1 с | 1 с | 1 с | 1 с | **3 с** |
| scale=10 | 805 000 | 37,9 МБ | 4 с | не замерялось | не замерялось | 6 с (БД 5 с) | 6 с + запуск PG |

- Число строк всех таблиц, сумма бонусов (405 000 000 коп.), контрольные md5 и все 11 файлов
  медиа совпали. Маркер, добавленный через 9 с после бэкапа, в восстановленной БД отсутствует —
  как и ожидается.
- **RPO** = время с последнего успешного бэкапа: при ежедневном расписании — **до 24 часов**
  (+ время бэкапа). В учении — 9 с. Если театру нужно меньше — чаще запускать бэкап или включить
  WAL-архивирование (PITR); решение — с театром (architecture.md §15).
- **RTO** технический (БД + проверка) — секунды на текущих объёмах. Полный RTO на проде
  определяется подготовкой сервера, `docker compose up --build` (сборка образа — минуты), DNS и
  проверкой — ориентир «до 1 часа» остаётся ориентиром до учения на проде.

### Проверенные отказы
- Неверный пароль БД → `ALERT_BACKUP_FAILED` (`step: counts`), exit 1, статус `failed` с прежним
  `lastSuccessAt`, частичный каталог удалён.
- Восстановление в непустую БД без `--clean` и без `--yes` без терминала → отказ (exit 2).
- Повреждённый файл копии → отказ на проверке `SHA256SUMS`; расхождение числа строк → exit 1
  (автотесты `tests/unit/backup-scripts.test.ts`).
- Остановленный worker: heartbeat перестал обновляться (через 8 минут — возраст 470 с, далее
  порог 15 минут → `checks.worker = "error"`, `ALERT_WORKER_STALE`).

### Найдено в учении
- ESM-бандл worker падал на `require('events')` драйвера pg — в Dockerfile добавлен `createRequire`-banner.
- Поля лога `authCodes`/`sessions` маскировались как секреты — уточнены правила и имена полей.

### Повторить на проде (чек-лист)
- [ ] Бэкап сервисом `backup` на реальной БД; время и размер.
- [ ] Восстановление на отдельной машине/VM по §7 «На новом сервере», включая сборку образа.
- [ ] Сверка числа заказов/билетов и медиа (когда появятся таблицы commerce и медиа в S3).
- [ ] Фактические RTO/RPO — в таблицу выше; согласовать с театром.
