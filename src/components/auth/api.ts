'use client'

/**
 * Запрос к API кабинета: JSON туда и обратно, сетевые ошибки — как status 0. Ошибки API —
 * `{ code, message, correlationId }` (T-015); формы читают `error`, поэтому он заполняется из
 * `code ?? error` (старый формат тоже понимаем).
 */
export async function postJson<T = Record<string, unknown>>(
  path: string,
  body: unknown,
): Promise<{ status: number; data: T | null }> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.code === 'string')
      data.error = data.code
    return { status: res.status, data: data as T | null }
  } catch {
    return { status: 0, data: null }
  }
}

/** Куда вернуть после входа: ?next=/путь (только свой сайт), иначе кабинет. */
export const returnPath = () => {
  const next = new URLSearchParams(window.location.search).get('next')
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/account'
}
