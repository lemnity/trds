import type { NextRequest } from 'next/server'

import { getAccounts, SESSION_COOKIE } from '@/modules/accounts'

/** Покупатель из серверной сессии (HttpOnly cookie) или null — гость. customerId из запроса не берём. */
export const sessionCustomerId = async (req: NextRequest): Promise<string | null> => {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (!token) return null
  const { auth } = await getAccounts()
  const session = await auth.getSession(token)
  return session?.customer.id ?? null
}

/** Адрес сайта для возврата из банка: из настроек сайта, иначе — адрес запроса. */
export const siteOrigin = (req: NextRequest) =>
  (process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin).replace(/\/$/, '')

/** Тело не больше `max` байт: по заголовку и по факту (заголовок можно не прислать). */
export const readBody = async (req: Request, max: number): Promise<string | null> => {
  if (Number(req.headers.get('content-length') ?? 0) > max) return null
  const text = await req.text()
  return Buffer.byteLength(text) > max ? null : text
}

export const noStore = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
