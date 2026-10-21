import type { NextRequest } from 'next/server'

import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'

import { clearedSessionCookie, json, sameOrigin } from '../http'

export const dynamic = 'force-dynamic'

/** POST /api/auth/logout — отозвать сессию в базе и стереть cookie. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403)
  const { auth } = await getAccounts()
  await auth.logout(req.cookies.get(SESSION_COOKIE)?.value)
  return json({ ok: true }, 200, { 'Set-Cookie': clearedSessionCookie() })
}
