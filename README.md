# Театр «Турдус» — сайт и билетная система

Next.js + Payload CMS + PostgreSQL. Документация проекта: `PRD.md`, `architecture.md`, `rules.md`, `design.md`, `tasks.md`, `memory.md`; сводный план — `plan/plan-main.md`.

Версии закреплены (`architecture.md` §2): Node.js из `.node-version`, pnpm через corepack (`packageManager`).

## Локальная разработка

```sh
corepack enable
pnpm install
cp .env.example .env   # заполнить PAYLOAD_SECRET и пароль в DATABASE_URL

# PostgreSQL 16 только на 127.0.0.1:5436
docker run -d --name trds-pg -e POSTGRES_USER=trds -e POSTGRES_DB=trds \
  -e POSTGRES_PASSWORD=<пароль из DATABASE_URL> -p 127.0.0.1:5436:5432 \
  -v trds-pg-data:/var/lib/postgresql/data postgres:16.15-alpine

pnpm dev --port 3010   # сайт: http://localhost:3010, админка: /admin, health: /api/health
```

## Проверки (как в CI)

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Production-окружение одной командой

Заполнить в `.env`: `POSTGRES_PASSWORD`, `PAYLOAD_SECRET`, `SITE_DOMAIN` (для production — без `HSTS_MAX_AGE`). Затем:

```sh
docker compose up -d --build
docker compose ps        # app и postgres должны быть healthy
```

Сервисы: `caddy` (HTTPS, единственный с опубликованными портами), `app` (Next.js + Payload), `worker` (фоновые задачи, тот же образ), `postgres` (только во внутренней сети, снаружи недоступен).
