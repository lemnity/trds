import type { NextRequest } from 'next/server'

import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'

import { clearedSessionCookie, fail, guarded, json, sameOrigin } from '../http'

export const dynamic = 'force-dynamic'

/** POST /api/auth/logout — отозвать сессию в базе и стереть cookie. 200 `{ ok }`; 403; 503. */
export const POST = guarded('auth.logout', async (req: NextRequest, ctx) => {
  if (!sameOrigin(req)) return fail.forbidden(ctx)
  const { auth } = await getAccounts()
  await auth.logout(req.cookies.get(SESSION_COOKIE)?.value)
  return json({ ok: true }, 200, { 'Set-Cookie': clearedSessionCookie() })
})
