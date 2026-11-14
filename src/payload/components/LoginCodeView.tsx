import { MinimalTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import { ADMIN_USERS_SLUG } from '../access/roles'
import { AdminLogo } from './AdminBrand'
import { LoginCodeForm } from './LoginCodeForm'

/**
 * Экран входа /admin/login вместо стандартного Payload: почта и код из письма, без пароля
 * (src/payload/auth/codeLogin.ts). Уже вошедшего — дальше, в админку (там MfaGate).
 */
export function LoginCodeView({ initPageResult, searchParams }: AdminViewServerProps) {
  const { req } = initPageResult
  const { routes, serverURL } = req.payload.config
  // Возврат только внутрь админки: внешний адрес в redirect не принимаем.
  const wanted = typeof searchParams?.redirect === 'string' ? searchParams.redirect : ''
  const nextUrl =
    wanted.startsWith(`${routes.admin}/`) && !wanted.startsWith('//') ? wanted : routes.admin
  if (req.user?.collection === ADMIN_USERS_SLUG) redirect(nextUrl)
  return (
    <MinimalTemplate>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem' }}>
        <AdminLogo />
      </div>
      <LoginCodeForm apiUrl={`${serverURL}${routes.api}/cms/auth`} nextUrl={nextUrl} />
    </MinimalTemplate>
  )
}

/** /admin/forgot: восстанавливать нечего — пароля нет; ведём на вход по коду. */
export function ForgotPasswordRedirect({ initPageResult }: AdminViewServerProps) {
  redirect(`${initPageResult.req.payload.config.routes.admin}/login`)
}
