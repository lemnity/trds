'use client'

import { useAuth, useConfig } from '@payloadcms/ui'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'

/**
 * Перенаправляет на /admin/mfa, пока второй фактор не пройден. Это удобство интерфейса:
 * сами права закрыты на сервере (access layer считает такого сотрудника анонимом).
 */
export function MfaGate({ children }: { children?: ReactNode }) {
  const { user } = useAuth()
  const { config } = useConfig()
  const pathname = usePathname()
  const router = useRouter()
  const mfaPath = `${config.routes.admin}/mfa`

  useEffect(() => {
    if (!user || pathname === mfaPath) return
    let cancelled = false
    fetch(`${config.serverURL}${config.routes.api}/admin-users/mfa/status`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { required?: boolean; verified?: boolean } | null) => {
        if (!cancelled && s?.required && !s.verified) router.replace(mfaPath)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user, pathname, mfaPath, config.serverURL, config.routes.api, router])

  return <>{children}</>
}
