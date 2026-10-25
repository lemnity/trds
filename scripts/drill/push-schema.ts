import config from '@payload-config'
import { getPayload } from 'payload'

/**
 * Учение восстановления (T-072, docs/runbook.md): создать схему Payload и доменных таблиц в пустой
 * учебной БД. Payload синхронизирует схему (push) только в dev-режиме:
 *
 *   NODE_ENV=development DATABASE_URL=postgres://…@127.0.0.1:<порт учебной БД>/trds \
 *     PAYLOAD_SECRET=<любые 32+ символа> pnpm -s payload run scripts/drill/push-schema.ts
 *
 * Только для учебной БД на localhost — продуктивная схема меняется миграциями (rules.md §5).
 */
const url = new URL(process.env.DATABASE_URL ?? 'invalid://')
if (process.env.NODE_ENV !== 'development' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
  process.stderr.write('drill only: NODE_ENV=development and a database on localhost\n')
  process.exit(2)
}

const payload = await getPayload({ config })
const { rows } = await payload.db.drizzle.execute(
  "select count(*)::int as tables from information_schema.tables where table_schema = 'public'",
)
process.stdout.write(`drill.schema_ready ${JSON.stringify(rows[0])}\n`)
process.exit(0)
