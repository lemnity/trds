# syntax=docker/dockerfile:1
# Версия Node.js совпадает с .node-version; digest закрепляет образ (T-005, ADR-007).
# Обновление: сменить тег и digest вместе, затем прогнать CI.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
# NEXT_PUBLIC_* встраиваются в клиентский код на этапе сборки (docker-compose.yml, x-app-build).
ARG NEXT_PUBLIC_SITE_URL=
ARG NEXT_PUBLIC_YM_ID=
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_YM_ID=$NEXT_PUBLIC_YM_ID
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Banner worker: драйвер pg (CommonJS) делает require('events') — в ESM-бандле нужен createRequire.
RUN pnpm build \
 && pnpm exec esbuild src/jobs/main.ts --bundle --platform=node --format=esm --target=node24 \
      "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
      --outfile=dist/worker.mjs \
 && pnpm exec esbuild src/bin/start-app.ts --bundle --platform=node --format=esm --target=node24 --outfile=dist/start.mjs

# Одноразовые миграции БД (сервис migrate в docker-compose.yml): нужен Payload CLI с исходниками,
# которых нет в standalone-образе runner.
FROM builder AS migrator
ENV NODE_ENV=production
CMD ["pnpm", "-s", "payload", "migrate"]

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# /app/state — точка монтирования тома ops-state (heartbeat worker, итог бэкапа): владелец nextjs,
# чтобы Docker при первом монтировании скопировал права в пустой том.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs \
 && mkdir -p /app/state /app/media \
 && chown nextjs:nodejs /app/state /app/media
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Worker: тот же образ, отдельная команда `node worker.mjs` (docker-compose.yml).
COPY --from=builder --chown=nextjs:nodejs /app/dist/worker.mjs ./worker.mjs
# App: проверка env до запуска Next.js (src/bin/start-app.ts).
COPY --from=builder --chown=nextjs:nodejs /app/dist/start.mjs ./start.mjs
USER nextjs
EXPOSE 3000
CMD ["node", "start.mjs"]
