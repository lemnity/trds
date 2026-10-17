'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/** Страницы без шапки, подвала и плавающей кнопки покупки — вход и регистрация. */
const BARE = ['/login', '/register']

/**
 * Обвязка сайта (шапка, подвал, кнопка покупки) вокруг контента. Шапку и подвал рендерит
 * сервер и передаёт сюда; на «голых» страницах они не выводятся. Путь известен при сборке —
 * без мигания.
 */
export function SiteChrome({
  header,
  footer,
  extras,
  children,
}: {
  header: ReactNode
  footer: ReactNode
  extras: ReactNode
  children: ReactNode
}) {
  const pathname = usePathname()
  const bare = BARE.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  return (
    <>
      {!bare && header}
      <main id="main">{children}</main>
      {!bare && footer}
      {!bare && extras}
    </>
  )
}
