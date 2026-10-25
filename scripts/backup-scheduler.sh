#!/usr/bin/env bash
# Ежедневный запуск scripts/backup.sh в сервисе compose `backup` (T-014).
# BACKUP_AT — время запуска по UTC в формате ЧЧ:ММ (по умолчанию 00:30 UTC = 03:30 МСК).
# Неудача бэкапа не останавливает расписание: сигнал уже в логе и в файле статуса.
set -uo pipefail

BACKUP_AT="${BACKUP_AT:-00:30}"
case "$BACKUP_AT" in
  [0-2][0-9]:[0-5][0-9]) ;;
  *) echo "BACKUP_AT must be HH:MM (UTC)" >&2; exit 2 ;;
esac
HERE=$(cd "$(dirname "$0")" && pwd)

printf '{"ts":"%s","level":"info","event":"backup.scheduler_started","service":"backup","at":"%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BACKUP_AT"

# PID 1 в контейнере: без trap bash игнорирует SIGTERM и docker stop ждёт 10 секунд.
trap 'exit 0' TERM INT

LAST_DAY=""
while true; do
  today=$(date -u +%Y-%m-%d)
  if [ "$(date -u +%H:%M)" = "$BACKUP_AT" ] && [ "$today" != "$LAST_DAY" ]; then
    LAST_DAY="$today"
    "$HERE/backup.sh" || true
  fi
  sleep 20 &
  wait $!
done
