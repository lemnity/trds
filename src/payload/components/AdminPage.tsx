import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'
import type { ReactNode } from 'react'

import { ADMIN_USERS_SLUG, activeStaff, hasRole, type StaffRole } from '../access/roles'

/**
 * Обёртка своих разделов админки (канбан, сертификаты): стандартный шаблон Payload с меню и
 * проверка роли на сервере. Без нужной роли раздел не рендерится; API под ним закрыт отдельно
 * (src/payload/endpoints) — экран только удобство.
 */
export function AdminPage({
  props,
  roles,
  path,
  children,
}: {
  props: AdminViewServerProps
  roles: readonly StaffRole[]
  /** Путь раздела внутри /admin — для возврата после входа. */
  path: string
  children: (ctx: { apiUrl: string }) => ReactNode
}) {
  const { initPageResult, params, searchParams } = props
  const { req } = initPageResult
  const { routes, serverURL } = req.payload.config
  const user = req.user as { collection?: string } | null
  if (!user || user.collection !== ADMIN_USERS_SLUG)
    redirect(`${routes.admin}/login?redirect=${encodeURIComponent(`${routes.admin}${path}`)}`)
  // Второй фактор не пройден — сначала экран MFA (права до него не действуют).
  if (!activeStaff(req)) redirect(`${routes.admin}/mfa`)
  const allowed = hasRole(req, roles)
  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={initPageResult.locale}
      params={params}
      payload={req.payload}
      permissions={initPageResult.permissions}
      searchParams={searchParams}
      user={req.user ?? undefined}
      visibleEntities={initPageResult.visibleEntities}
    >
      <Gutter>
        {allowed ? (
          children({ apiUrl: `${serverURL}${routes.api}` })
        ) : (
          <p role="alert" style={{ marginTop: '2rem' }}>
            Раздел доступен администратору театра.
          </p>
        )}
      </Gutter>
    </DefaultTemplate>
  )
}
