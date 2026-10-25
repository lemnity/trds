import config from '@payload-config'
import { getPayload } from 'payload'

import { seedCms } from '@/payload/seed'

/**
 * Наполнение пустой CMS демо-набором (реальные данные с teatrturdus.ru) — T-021…T-026:
 *
 *   pnpm -s cms:seed
 *
 * Идемпотентно: повторный запуск обновляет те же записи. Перед запуском на staging/production
 * схема должна быть применена миграциями (`pnpm payload migrate`).
 */
const payload = await getPayload({ config })
const report = await seedCms(payload, {
  root: process.cwd(),
  log: (line) => process.stdout.write(`cms.seed ${line}\n`),
})
process.stdout.write(`cms.seed.done ${JSON.stringify(report)}\n`)
process.exit(0)
