import type { NextRequest } from 'next/server'

import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'

import { json } from '../http'

export const dynamic = 'force-dynamic'

/** GET /api/auth/session — кто вошёл (имя и почта) или null. */
export async function GET(req: NextRequest) {
  try {
    const { auth } = await getAccounts()
    const session = await auth.getSession(req.cookies.get(SESSION_COOKIE)?.value)
    return json({
      customer: session ? { name: session.customer.name, email: session.customer.email } : null,
    })
  } catch {
    // База недоступна — меню показывает гостя, страница не висит.
    return json({ customer: null, error: 'unavailable' }, 503)
  }
}
