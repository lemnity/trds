#!/usr/bin/env bash
# Восстановление из копии scripts/backup.sh (T-014, T-072). Процедура — docs/runbook.md.
#
#   scripts/restore.sh --from DIR --target-db NAME [--media-dest DIR] [--clean] [--yes]
#
# Подключение к серверу БД — переменные libpq (PGHOST, PGPORT, PGUSER, PGPASSWORD) или
# TARGET_DATABASE_URL (тогда --target-db берётся из URL и указывать его не нужно).
#
# Порядок: проверка SHA256SUMS → подтверждение → проверка, что целевая БД пуста (или --clean) →
# pg_restore одной транзакцией → сверка числа строк с counts.tsv → распаковка медиа.
# Любое расхождение — exit 1. Восстановление в продуктивную БД — только по runbook и с --clean.
set -Eeuo pipefail
umask 077

usage() {
  cat <<'EOF'
usage: scripts/restore.sh --from DIR [--target-db NAME] [--media-dest DIR] [--clean] [--yes]

  --from DIR         каталог копии trds-<время> (с SHA256SUMS)
  --target-db NAME   целевая БД (или из TARGET_DATABASE_URL); должна существовать
  --media-dest DIR   куда распаковать медиа (пустой или несуществующий каталог)
  --clean            разрешить восстановление поверх существующих таблиц (DROP … IF EXISTS)
  --yes              не спрашивать подтверждение (для скриптов и учений)
EOF
}

FROM=""
TARGET_DB=""
MEDIA_DEST=""
CLEAN=0
YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="${2:?--from needs a value}"; shift 2 ;;
    --target-db) TARGET_DB="${2:?--target-db needs a value}"; shift 2 ;;
    --media-dest) MEDIA_DEST="${2:?--media-dest needs a value}"; shift 2 ;;
    --clean) CLEAN=1; shift ;;
    --yes) YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

DB_CONN=""
if [ -n "${TARGET_DATABASE_URL:-}" ]; then
  DB_CONN="--dbname=$TARGET_DATABASE_URL"
  # Имя БД — последний сегмент пути URL, без параметров.
  url_db="${TARGET_DATABASE_URL##*/}"
  url_db="${url_db%%\?*}"
  if [ -n "$TARGET_DB" ] && [ "$TARGET_DB" != "$url_db" ]; then
    echo "--target-db does not match TARGET_DATABASE_URL" >&2
    exit 2
  fi
  TARGET_DB="$url_db"
elif [ -n "$TARGET_DB" ]; then
  DB_CONN="--dbname=$TARGET_DB"
fi

[ -n "$FROM" ] || { echo "--from is required" >&2; usage >&2; exit 2; }
[ -n "$TARGET_DB" ] || { echo "--target-db (or TARGET_DATABASE_URL) is required" >&2; usage >&2; exit 2; }
case "$TARGET_DB" in
  *[!A-Za-z0-9_-]*) echo "--target-db has unexpected characters" >&2; exit 2 ;;
esac
[ -f "$FROM/SHA256SUMS" ] && [ -f "$FROM/db.dump" ] || { echo "--from is not a backup directory" >&2; exit 2; }

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log_json() {
  local level="$1" event="$2"
  shift 2
  local extra=""
  while [ $# -gt 1 ]; do
    extra="$extra,\"$1\":$2"
    shift 2
  done
  printf '{"ts":"%s","level":"%s","event":"%s","service":"restore"%s}\n' "$(now_iso)" "$level" "$event" "$extra"
}
str() { printf '"%s"' "$1"; }

STEP="init"
on_error() {
  local code=$?
  trap - ERR
  log_json error restore.failed step "$(str "$STEP")" exitCode "$code" >&2
  exit 1
}
trap on_error ERR
STARTED_EPOCH=$(date -u +%s)
BACKUP_NAME=$(basename "$FROM")

STEP="checksum"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$FROM" && sha256sum -c SHA256SUMS >&2)
else
  (cd "$FROM" && shasum -a 256 -c SHA256SUMS >&2)
fi
log_json info restore.checksum_ok backup "$(str "$BACKUP_NAME")"

STEP="confirm"
if [ "$YES" -ne 1 ]; then
  if [ ! -t 0 ]; then
    echo "refusing to restore without --yes when stdin is not a terminal" >&2
    exit 2
  fi
  printf 'Восстановить %s в БД "%s"%s? Введите имя БД для подтверждения: ' \
    "$BACKUP_NAME" "$TARGET_DB" "$([ "$CLEAN" -eq 1 ] && echo ' (существующие таблицы будут удалены)')" >&2
  read -r answer
  [ "$answer" = "$TARGET_DB" ] || { echo "not confirmed" >&2; exit 2; }
fi

psql_q() { psql -X -A -t -q -v ON_ERROR_STOP=1 -F $'\t' ${DB_CONN:+"$DB_CONN"} -c "$1"; }

STEP="target_check"
EXISTING=$(psql_q "select count(*) from information_schema.tables where table_schema = 'public'")
if [ "$EXISTING" -gt 0 ] && [ "$CLEAN" -ne 1 ]; then
  echo "target database \"$TARGET_DB\" is not empty ($EXISTING tables); use --clean to overwrite" >&2
  exit 2
fi
if [ -n "$MEDIA_DEST" ] && [ -d "$MEDIA_DEST" ] && [ -n "$(ls -A "$MEDIA_DEST")" ]; then
  echo "--media-dest is not empty" >&2
  exit 2
fi

STEP="pg_restore"
RESTORE_FLAGS="--no-owner --no-privileges --exit-on-error --single-transaction"
if [ "$CLEAN" -eq 1 ]; then RESTORE_FLAGS="$RESTORE_FLAGS --clean --if-exists"; fi
# shellcheck disable=SC2086 # флаги без пробелов
pg_restore $RESTORE_FLAGS ${DB_CONN:+"$DB_CONN"} "$FROM/db.dump"
DB_DONE_EPOCH=$(date -u +%s)

STEP="verify_counts"
ACTUAL=$(psql_q "
  select table_name,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by table_name")
ROWS=0
while IFS=$'\t' read -r table count; do
  [ -n "$table" ] && ROWS=$((ROWS + count))
done <"$FROM/counts.tsv"
if [ "$ACTUAL" != "$(cat "$FROM/counts.tsv")" ]; then
  log_json error restore.counts_mismatch backup "$(str "$BACKUP_NAME")" >&2
  diff <(printf '%s\n' "$ACTUAL") "$FROM/counts.tsv" >&2 || true
  false
fi
TABLES=$(grep -c . "$FROM/counts.tsv" || true)
log_json info restore.counts_ok tables "${TABLES:-0}" rows "$ROWS"

STEP="media"
MEDIA_FILES=0
if [ -f "$FROM/media.tar.gz" ]; then
  if [ -n "$MEDIA_DEST" ]; then
    mkdir -p "$MEDIA_DEST"
    tar -xzf "$FROM/media.tar.gz" -C "$MEDIA_DEST"
    MEDIA_FILES=$(find "$MEDIA_DEST" -type f | wc -l | tr -d ' ')
    EXPECTED=$(sed -n 's/.*"mediaFiles": *\([0-9]*\).*/\1/p' "$FROM/manifest.json")
    if [ -n "$EXPECTED" ] && [ "$MEDIA_FILES" != "$EXPECTED" ]; then
      log_json error restore.media_mismatch expected "$EXPECTED" actual "$MEDIA_FILES" >&2
      false
    fi
  else
    log_json warn restore.media_skipped reason "$(str media_dest_not_set)"
  fi
fi

END_EPOCH=$(date -u +%s)
log_json info restore.done backup "$(str "$BACKUP_NAME")" targetDb "$(str "$TARGET_DB")" \
  dbSec "$((DB_DONE_EPOCH - STARTED_EPOCH))" totalSec "$((END_EPOCH - STARTED_EPOCH))" \
  mediaFiles "$MEDIA_FILES"
