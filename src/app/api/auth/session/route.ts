import type { NextRequest } from 'next/server'

import { withCorrelation } from '@/lib/correlation'
import { errorInfo } from '@/lib/log'
import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'

import { json } from '../http'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/session — кто вошёл (имя и почта) или null. База недоступна — 503 с тем же
 * `customer: null` (меню показывает гостя) плюс `{ code, message, correlationId }`.
 */
export const GET = withCorrelation('auth.session', async (req: NextRequest, ctx) => {
  try {
    const { auth } = await getAccounts()
    const session = await auth.getSession(req.cookies.get(SESSION_COOKIE)?.value)
    return json({
      customer: session ? { name: session.customer.name, email: session.customer.email } : null,
    })
  } catch (error) {
    // База недоступна — меню показывает гостя, страница не висит.
    ctx.log.warn('auth.session_unavailable', { error: errorInfo(error) })
    return json(
      {
        customer: null,
        code: 'unavailable',
        message: 'Сервис временно недоступен.',
        correlationId: ctx.correlationId,
      },
      503,
    )
  }
})
