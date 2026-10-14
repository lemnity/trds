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
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build \
 && pnpm exec esbuild src/jobs/main.ts --bundle --platform=node --format=esm --target=node24 --outfile=dist/worker.mjs \
 && pnpm exec esbuild src/bin/start-app.ts --bundle --platform=node --format=esm --target=node24 --outfile=dist/start.mjs

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Worker: тот же образ, отдельная команда `node worker.mjs` (docker-compose.yml).
COPY --from=builder --chown=nextjs:nodejs /app/dist/worker.mjs ./worker.mjs
# App: проверка env до запуска Next.js (src/bin/start-app.ts).
COPY --from=builder --chown=nextjs:nodejs /app/dist/start.mjs ./start.mjs
USER nextjs
EXPOSE 3000
CMD ["node", "start.mjs"]
