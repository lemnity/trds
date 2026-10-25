#!/usr/bin/env bash
# Резервная копия БД и медиа (T-014, architecture.md §15). Процедура и проверка — docs/runbook.md.
#
#   scripts/backup.sh [--dest DIR] [--retention-days N] [--media-dir DIR] [--status-file FILE]
#
# Подключение к БД — стандартные переменные libpq (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE)
# или DATABASE_URL. Пароль в аргументы не передаётся (виден в списке процессов) — только через env.
#
# Результат: DIR/trds-<UTC-время>/ с db.dump (pg_dump custom), media.tar.gz (если задан каталог
# медиа), counts.tsv (число строк по таблицам — для сверки после восстановления), manifest.json,
# SHA256SUMS. Каталог появляется только целиком (сборка во временном, затем переименование).
# Копии старше N дней удаляются, последняя успешная — никогда.
#
# Лог — JSON-строки (как у app/worker). Ошибка: exit 1 и сигнал "alert":"ALERT_BACKUP_FAILED".
# Внешняя копия (S3 в РФ) — заглушка: провайдер не выбран (BACKUP_OFFSITE_TARGET только логируется).
set -Eeuo pipefail
umask 077

usage() {
  cat <<'EOF'
usage: scripts/backup.sh [--dest DIR] [--retention-days N] [--media-dir DIR] [--status-file FILE]

  --dest DIR            куда класть копии (env BACKUP_DIR, по умолчанию ./backups)
  --retention-days N    сколько дней хранить (env BACKUP_RETENTION_DAYS, по умолчанию 14)
  --media-dir DIR       каталог медиа для архива (env MEDIA_DIR; не задан — медиа пропускаются)
  --status-file FILE    куда записать итог для /api/health (env BACKUP_STATUS_FILE)
EOF
}

DEST="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
MEDIA="${MEDIA_DIR:-}"
STATUS_FILE="${BACKUP_STATUS_FILE:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST="${2:?--dest needs a value}"; shift 2 ;;
    --retention-days) RETENTION_DAYS="${2:?--retention-days needs a value}"; shift 2 ;;
    --media-dir) MEDIA="${2:?--media-dir needs a value}"; shift 2 ;;
    --status-file) STATUS_FILE="${2:?--status-file needs a value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$RETENTION_DAYS" in
  ''|*[!0-9]*) echo "--retention-days must be a positive integer" >&2; exit 2 ;;
esac
if [ "$RETENTION_DAYS" -lt 1 ]; then
  echo "--retention-days must be a positive integer" >&2
  exit 2
fi
if [ -n "$MEDIA" ] && [ ! -d "$MEDIA" ]; then
  echo "--media-dir is not a directory" >&2
  exit 2
fi

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# JSON-строка лога. Значения — только наши (имена шагов, размеры), без вывода утилит.
log_json() {
  local level="$1" event="$2"
  shift 2
  local extra=""
  while [ $# -gt 1 ]; do
    extra="$extra,\"$1\":$2"
    shift 2
  done
  printf '{"ts":"%s","level":"%s","event":"%s","service":"backup"%s}\n' "$(now_iso)" "$level" "$event" "$extra"
}
str() { printf '"%s"' "$1"; }

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}
size_of() { wc -c <"$1" | tr -d ' '; }

STARTED_EPOCH=$(date -u +%s)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
NAME="trds-$STAMP"
STEP="init"
WORK=""
LOCK=""

previous_success() {
  # lastSuccessAt из прошлого статуса — чтобы неудача не стирала дату последней удачной копии.
  [ -n "$STATUS_FILE" ] && [ -f "$STATUS_FILE" ] &&
    sed -n 's/.*"lastSuccessAt":"\([^"]*\)".*/\1/p' "$STATUS_FILE" | head -n 1
}

write_status() {
  [ -n "$STATUS_FILE" ] || return 0
  local tmp="$STATUS_FILE.tmp.$$"
  printf '%s\n' "$1" >"$tmp" && chmod 644 "$tmp" && mv "$tmp" "$STATUS_FILE"
}

on_error() {
  local code=$?
  trap - ERR
  log_json error alert alert "$(str ALERT_BACKUP_FAILED)" step "$(str "$STEP")" exitCode "$code" >&2
  local last
  last=$(previous_success || true)
  write_status "{\"status\":\"failed\",\"at\":\"$(now_iso)\",\"step\":\"$STEP\",\"lastSuccessAt\":\"${last:-}\"}" || true
  [ -n "$WORK" ] && rm -rf "$WORK"
  [ -n "$LOCK" ] && rmdir "$LOCK" 2>/dev/null
  exit 1
}
trap on_error ERR

STEP="prepare"
mkdir -p "$DEST"
# Один бэкап за раз: mkdir атомарен. Зависший lock старше суток снимается вручную (runbook).
LOCK="$DEST/.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  LOCK=""
  STEP="lock"
  false
fi
trap '[ -n "$LOCK" ] && rmdir "$LOCK" 2>/dev/null; true' EXIT
WORK="$DEST/.$NAME.partial"
mkdir "$WORK"

# PG* важнее DATABASE_URL; URL передаётся как --dbname (libpq понимает строку подключения).
DB_CONN=""
if [ -n "${DATABASE_URL:-}" ] && [ -z "${PGHOST:-}" ]; then DB_CONN="--dbname=$DATABASE_URL"; fi

log_json info backup.started name "$(str "$NAME")" media "$([ -n "$MEDIA" ] && echo true || echo false)"

STEP="counts"
# Точное число строк по каждой таблице схемы public — эталон для restore.sh.
psql -X -A -t -q -v ON_ERROR_STOP=1 -F $'\t' ${DB_CONN:+"$DB_CONN"} -c "
  select table_name,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by table_name" >"$WORK/counts.tsv"

STEP="pg_dump"
pg_dump --format=custom --compress=6 --no-owner --no-privileges ${DB_CONN:+"$DB_CONN"} --file="$WORK/db.dump"

STEP="verify_dump"
# Архив читается и содержит оглавление — иначе это не копия.
pg_restore --list "$WORK/db.dump" >/dev/null

STEP="media"
if [ -n "$MEDIA" ]; then
  tar -czf "$WORK/media.tar.gz" -C "$MEDIA" .
  MEDIA_FILES=$(find "$MEDIA" -type f | wc -l | tr -d ' ')
else
  MEDIA_FILES=0
  log_json warn backup.media_skipped reason "$(str media_dir_not_set)"
fi

STEP="manifest"
PG_DUMP_VERSION=$(pg_dump --version | head -n 1 | tr -d '"\\')
TABLES=$(wc -l <"$WORK/counts.tsv" | tr -d ' ')
cat >"$WORK/manifest.json" <<EOF
{
  "name": "$NAME",
  "createdAt": "$(now_iso)",
  "pgDump": "$PG_DUMP_VERSION",
  "tables": $TABLES,
  "dbDumpBytes": $(size_of "$WORK/db.dump"),
  "media": $([ -n "$MEDIA" ] && echo true || echo false),
  "mediaFiles": $MEDIA_FILES
}
EOF

STEP="checksum"
FILES="db.dump counts.tsv manifest.json"
if [ -n "$MEDIA" ]; then FILES="$FILES media.tar.gz"; fi
# shellcheck disable=SC2086 # список имён без пробелов
(cd "$WORK" && sha256 $FILES >SHA256SUMS)

STEP="publish"
mv "$WORK" "$DEST/$NAME"
WORK=""

STEP="retention"
# Удаляем копии старше N дней; только что созданную не трогаем (она моложе суток).
PRUNED=0
for old in $(find "$DEST" -mindepth 1 -maxdepth 1 -type d -name 'trds-*' -mtime "+$((RETENTION_DAYS - 1))" | sort); do
  [ "$old" = "$DEST/$NAME" ] && continue
  rm -rf "$old"
  PRUNED=$((PRUNED + 1))
done
# Брошенные незавершённые каталоги прошлых неудачных запусков.
find "$DEST" -mindepth 1 -maxdepth 1 -type d -name '.trds-*.partial' -mtime +0 -exec rm -rf {} + 2>/dev/null || true

STEP="offsite"
OFFSITE="disabled"
if [ -n "${BACKUP_OFFSITE_TARGET:-}" ]; then
  # Заглушка: провайдер S3 в РФ не выбран (architecture.md §2). Копирование добавить после выбора.
  OFFSITE="not_implemented"
  log_json warn backup.offsite_skipped reason "$(str provider_not_chosen)"
fi

DONE_AT=$(now_iso)
write_status "{\"status\":\"ok\",\"at\":\"$DONE_AT\",\"lastSuccessAt\":\"$DONE_AT\",\"backup\":\"$NAME\",\"offsite\":\"$OFFSITE\"}"
log_json info backup.done name "$(str "$NAME")" durationSec "$(($(date -u +%s) - STARTED_EPOCH))" \
  dbDumpBytes "$(size_of "$DEST/$NAME/db.dump")" tables "$TABLES" mediaFiles "$MEDIA_FILES" \
  pruned "$PRUNED" offsite "$(str "$OFFSITE")"
