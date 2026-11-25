import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { ru } from '@payloadcms/translations/languages/ru'
import os from 'os'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { accountsTables } from './db/schema/accounts'
import { commerceTables } from './db/schema/commerce'
import { leadsTables } from './db/schema/leads'
import { opsTables } from './db/schema/ops'
import { walletTables } from './db/schema/wallet'
import { collections } from './payload/collections'
import { codeLoginEndpoints } from './payload/auth/codeLogin'
import { AdminUsers } from './payload/collections/AdminUsers'
import { refundEndpoints } from './payload/components/refunds/endpoints'
import { refundClaimEndpoints } from './payload/components/refunds/claimEndpoints'
import { certificateEndpoints } from './payload/endpoints/certificates'
import { leadEndpoints } from './payload/endpoints/leads'
import { SiteSettings } from './payload/globals/SiteSettings'
import { storagePlugins } from './payload/storage'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Пустые значения допустимы только на этапе `next build`: при старте сервера и worker
// окружение проверяет assertServerEnv (src/bin/start-app.ts, src/jobs/main.ts).
const config = buildConfig({
  admin: {
    user: AdminUsers.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: { titleSuffix: ' — TURDUS CMS' },
    dateFormat: 'd MMMM yyyy, HH:mm',
    // Второй фактор (T-023): экран /admin/mfa и перенаправление на него до прохождения MFA.
    // Канбан корпоративов (T-065) и сертификаты (T-066) — свои разделы в стандартном шаблоне.
    components: {
      graphics: {
        Icon: '/payload/components/AdminBrand#AdminIcon',
        Logo: '/payload/components/AdminBrand#AdminLogo',
      },
      providers: ['/payload/components/MfaGate#MfaGate'],
      // Меню по задачам театра: группы с разделами Payload и своими экранами (AdminNav.tsx).
      beforeNavLinks: ['/payload/components/AdminNav#AdminNav'],
      views: {
        // Вход без пароля: почта → код из письма → код из приложения (src/payload/auth/codeLogin.ts).
        login: {
          Component: '/payload/components/LoginCodeView#LoginCodeView',
          path: '/login',
          meta: { title: 'Вход' },
        },
        forgot: {
          Component: '/payload/components/LoginCodeView#ForgotPasswordRedirect',
          path: '/forgot',
        },
        mfa: {
          Component: '/payload/components/MfaView#MfaView',
          path: '/mfa',
          meta: { title: 'Второй фактор' },
        },
        leads: {
          Component: '/payload/components/leads/LeadsView#LeadsView',
          path: '/leads',
          meta: { title: 'Корпоративы' },
        },
        certificates: {
          Component: '/payload/components/certificates/CertificatesView#CertificatesView',
          path: '/certificates',
          meta: { title: 'Подарочные сертификаты' },
        },
        // Возвраты (T-053): кассир и администратор.
        refunds: {
          Component: '/payload/components/refunds/RefundsView#RefundsView',
          path: '/refunds',
          meta: { title: 'Возвраты' },
        },
      },
    },
  },
  // REST своих разделов админки: /api/cms/leads…, /api/cms/certificates… (права — внутри).
  endpoints: [
    ...codeLoginEndpoints(),
    ...leadEndpoints(),
    ...certificateEndpoints(),
    ...refundEndpoints(),
    ...refundClaimEndpoints(),
  ],
  // Коллекции и настройки CMS — src/payload (роли и доступы — src/payload/access/roles.ts).
  collections,
  globals: [SiteSettings],
  // Админка только на русском; переопределены строки, которые в стандартном переводе звучат
  // неестественно (галочки в списках — «Правда/Ложь», пустое значение — «Без метки»; у старых
  // записей без значения галочки ячейка запрашивает ключ `general:null`).
  i18n: {
    supportedLanguages: { ru },
    fallbackLanguage: 'ru',
    translations: {
      ru: {
        general: {
          true: 'Да',
          false: 'Нет',
          null: 'Нет',
          noLabel: '—',
          dashboard: 'Главная',
          email: 'Почта',
          emailAddress: 'Почта',
          createNewLabel: 'Создать: {{label}}',
          creatingNewLabel: 'Создание: {{label}}',
          searchBy: 'Поиск: {{label}}',
        },
        // «Добавить Должность» → «Добавить: Должность» (подпись не склоняется).
        fields: { addLabel: 'Добавить: {{label}}' },
      },
    },
  },
  plugins: storagePlugins(),
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET ?? '',
  // Загрузки в «Медиа» без ограничения размера (видео в новостях, решение заказчика 25.11.2026;
  // по умолчанию Payload режет файл на 20 МБ, запрос — на 50 МБ). Файл пишется во временную
  // папку, а не держится в памяти; таймаут — пауза между частями файла на медленной сети.
  // Загружают только сотрудники (права коллекции Media); лимит прокси — Caddyfile.
  upload: {
    limits: { fileSize: Infinity },
    requestSizeLimit: Infinity,
    useTempFiles: true,
    tempFileDir: path.join(os.tmpdir(), 'payload-uploads'),
    uploadTimeout: 10 * 60_000,
  },
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
          ...opsTables,
        },
      }),
    ],
  }),
  sharp,
})

/**
 * Пункт визуального редактора «Загрузить» (UploadFeature) на деле выбирает уже загруженный файл;
 * загрузка с компьютера — отдельный пункт «Загрузить фото или видео» (payload/lexical). Подписи
 * фич Lexical накладываются поверх `i18n.translations` при сборке конфига, поэтому меняем после.
 */
export default config.then((built) => {
  const ru = built.i18n.translations.ru as { lexical?: { upload?: { label?: string } } } | undefined
  if (ru?.lexical?.upload) ru.lexical.upload.label = 'Выбрать из «Медиа»'
  return built
})
