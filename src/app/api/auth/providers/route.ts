import { withCorrelation } from '@/lib/correlation'
import { yandexConfig } from '@/modules/accounts'

import { json } from '../http'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/providers — какие внешние способы входа включены: `{ yandex: boolean }`.
 * Страницы входа статические, поэтому кнопка «Войти с Яндекс ID» спрашивает сервер: без
 * настроек YANDEX_* её нет. Секреты и client_id не отдаются.
 */
export const GET = withCorrelation('auth.providers', async () =>
  json({ yandex: yandexConfig() !== null }),
)
