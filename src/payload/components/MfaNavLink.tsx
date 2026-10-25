'use client'

import { useConfig } from '@payloadcms/ui'
import Link from 'next/link'

/** Ссылка на экран второго фактора в меню админки (коды восстановления, смена телефона). */
export function MfaNavLink() {
  const { config } = useConfig()
  return (
    <Link href={`${config.routes.admin}/mfa`} className="nav__link">
      <span className="nav__link-label">Второй фактор</span>
    </Link>
  )
}
