'use client'

/** Запрос к API кабинета: JSON туда и обратно, сетевые ошибки — как status 0. */
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
    return { status: res.status, data: (await res.json().catch(() => null)) as T | null }
  } catch {
    return { status: 0, data: null }
  }
}

/** Куда вернуть после входа: ?next=/путь (только свой сайт), иначе кабинет. */
export const returnPath = () => {
  const next = new URLSearchParams(window.location.search).get('next')
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/account'
}
