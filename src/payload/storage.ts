import type { Plugin } from 'payload'

/**
 * Хранилище медиа. ЗАГЛУШКА (T-020): провайдер S3 в РФ не выбран, поэтому файлы лежат на
 * локальном диске (коллекция `media`, `MEDIA_DIR`). Когда театр выберет провайдера:
 *   1. pnpm add @payloadcms/storage-s3@<та же версия, что payload>;
 *   2. вернуть здесь s3Storage({ collections: { media: true }, bucket: S3_BUCKET,
 *      config: { endpoint: S3_ENDPOINT, region: S3_REGION, forcePathStyle: true,
 *      credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY } } });
 *   3. добавить домен бакета в images.remotePatterns (next.config.ts) и перенести файлы.
 * Переменные S3_* уже перечислены в architecture.md §15; секреты — только из окружения.
 */
export const S3_ENV = [
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const

export const storagePlugins = (env: Record<string, string | undefined> = process.env): Plugin[] => {
  const configured = S3_ENV.filter((k) => env[k])
  if (configured.length > 0)
    console.warn(
      '[media] S3_* заданы, но адаптер S3 ещё не подключён — файлы сохраняются на локальный диск',
    )
  return []
}
