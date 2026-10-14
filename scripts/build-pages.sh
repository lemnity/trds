#!/usr/bin/env bash
# Сборка статического превью публичных страниц для GitHub Pages.
# Удаляет серверные маршруты (Payload Admin, API) — запускать только в одноразовой
# копии репозитория: в CI или во временном клоне. Результат: ./out
set -euo pipefail

if [[ "${CI:-}" != "true" && "${ALLOW_DESTRUCTIVE_PAGES_BUILD:-}" != "1" ]]; then
  echo "build-pages.sh удаляет src/app/(payload) и src/app/api; запускайте в CI или во временном клоне" >&2
  exit 1
fi

rm -rf "src/app/(payload)" src/app/api
PAGES_EXPORT=1 PAGES_BASE_PATH="${PAGES_BASE_PATH:-}" NEXT_TELEMETRY_DISABLED=1 pnpm build
touch out/.nojekyll
