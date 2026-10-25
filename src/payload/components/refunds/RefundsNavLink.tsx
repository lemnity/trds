'use client'

import { useAuth, useConfig } from '@payloadcms/ui'
import Link from 'next/link'

/** Пункт меню «Возвраты» — кассиру и администратору; права проверяет сервер (endpoints.ts). */
export function RefundsNavLink() {
  const { user } = useAuth<{ role?: string | null; systemAdmin?: boolean | null }>()
  const { config } = useConfig()
  if (!user || (user.role !== 'admin' && user.role !== 'cashier' && !user.systemAdmin)) return null
  return (
    <Link href={`${config.routes.admin}/refunds`} className="nav__link">
      <span className="nav__link-label">Возвраты</span>
    </Link>
  )
}
