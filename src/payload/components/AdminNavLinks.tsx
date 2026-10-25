'use client'

import { useAuth, useConfig } from '@payloadcms/ui'
import Link from 'next/link'

/**
 * Пункты меню своих разделов: канбан корпоративов и сертификаты. Видны администратору театра;
 * это удобство — права проверяет сервер (src/payload/endpoints, src/payload/components/AdminPage).
 */
export function AdminNavLinks() {
  const { user } = useAuth<{ role?: string | null; systemAdmin?: boolean | null }>()
  const { config } = useConfig()
  if (!user || (user.role !== 'admin' && !user.systemAdmin)) return null
  const admin = config.routes.admin
  return (
    <>
      <Link href={`${admin}/leads`} className="nav__link">
        <span className="nav__link-label">Корпоративы (канбан)</span>
      </Link>
      <Link href={`${admin}/certificates`} className="nav__link">
        <span className="nav__link-label">Подарочные сертификаты</span>
      </Link>
    </>
  )
}
