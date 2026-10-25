import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { accountsTables } from './db/schema/accounts'
import { commerceTables } from './db/schema/commerce'
import { leadsTables } from './db/schema/leads'
import { walletTables } from './db/schema/wallet'
import { collections } from './payload/collections'
import { AdminUsers } from './payload/collections/AdminUsers'
import { SiteSettings } from './payload/globals/SiteSettings'
import { storagePlugins } from './payload/storage'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Пустые значения допустимы только на этапе `next build`: при старте сервера и worker
// окружение проверяет assertServerEnv (src/bin/start-app.ts, src/jobs/main.ts).
export default buildConfig({
  admin: {
    user: AdminUsers.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: { titleSuffix: ' — TURDUS CMS' },
    // Второй фактор (T-023): экран /admin/mfa и перенаправление на него до прохождения MFA.
    components: {
      providers: ['/payload/components/MfaGate#MfaGate'],
      afterNavLinks: ['/payload/components/MfaNavLink#MfaNavLink'],
      views: {
        mfa: { Component: '/payload/components/MfaView#MfaView', path: '/mfa' },
      },
    },
  },
  // Коллекции и настройки CMS — src/payload (роли и доступы — src/payload/access/roles.ts).
  collections,
  globals: [SiteSettings],
  plugins: storagePlugins(),
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET ?? '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    // Миграции схемы (Payload + доменные таблицы из beforeSchemaInit) — src/db/migrations.
    migrationDir: path.resolve(dirname, 'db/migrations'),
    pool: {
      connectionString: process.env.DATABASE_URL ?? '',
      // Без базы — быстрая ошибка, а не вечное ожидание (кабинет и API отвечают «недоступно»).
      connectionTimeoutMillis: 5000,
    },
    // Доменные таблицы кабинета и бонусного кошелька (src/db/schema) — в общей схеме:
    // синхронизация в dev и миграции Payload их учитывают и не удаляют.
    beforeSchemaInit: [
      ({ schema }) => ({
        ...schema,
        tables: {
          ...schema.tables,
          ...accountsTables,
          ...walletTables,
          ...leadsTables,
          ...commerceTables,
        },
      }),
    ],
  }),
  sharp,
})
