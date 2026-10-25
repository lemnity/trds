import { MinimalTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import { ADMIN_USERS_SLUG, mfaRequired, mfaVerified, type StaffUser } from '../access/roles'
import { createMfaService, mfaKeysFromEnv } from '../auth/mfa'
import { payloadMfaStore } from '../auth/mfaStore'
import { MfaForm } from './MfaForm'

/**
 * Экран второго фактора /admin/mfa: настройка TOTP, ввод кода, коды восстановления.
 * Проверка — на сервере (src/payload/auth/endpoints.ts); экран только собирает ввод.
 */
export async function MfaView({ initPageResult }: AdminViewServerProps) {
  const { req } = initPageResult
  const { routes } = req.payload.config
  const user = req.user as StaffUser | null
  if (!user || user.collection !== ADMIN_USERS_SLUG)
    redirect(`${routes.admin}/login?redirect=${encodeURIComponent(`${routes.admin}/mfa`)}`)
  const status = await createMfaService({
    store: payloadMfaStore(req.payload),
    keys: mfaKeysFromEnv(),
  }).status(String(user.id))
  return (
    <MinimalTemplate>
      <MfaForm
        apiUrl={`${req.payload.config.serverURL}${routes.api}/${ADMIN_USERS_SLUG}/mfa`}
        adminUrl={routes.admin}
        initial={{
          required: mfaRequired(user),
          verified: mfaVerified(req, user),
          enrolled: status.enrolled,
          locked: status.locked,
          recoveryCodesLeft: status.recoveryCodesLeft,
        }}
      />
    </MinimalTemplate>
  )
}
