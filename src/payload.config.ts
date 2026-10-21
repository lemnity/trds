import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { accountsTables } from './db/schema/accounts'
import { AdminUsers } from './payload/collections/AdminUsers'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Пустые значения допустимы только на этапе `next build`: при старте сервера и worker
// окружение проверяет assertServerEnv (src/bin/start-app.ts, src/jobs/main.ts).
export default buildConfig({
  admin: {
    user: AdminUsers.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [AdminUsers],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET ?? '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL ?? '',
    },
    // Доменные таблицы кабинета (src/db/schema) — в общей схеме: синхронизация в dev и
    // миграции Payload их учитывают и не удаляют.
    beforeSchemaInit: [
      ({ schema }) => ({ ...schema, tables: { ...schema.tables, ...accountsTables } }),
    ],
  }),
  sharp,
})
