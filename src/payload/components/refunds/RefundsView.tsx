import type { AdminViewServerProps } from 'payload'

import { hasRole } from '../../access/roles'
import { AdminPage } from '../AdminPage'
import { REFUND_POLICY_ROLES, REFUNDS_ROLES } from './endpoints'
import { RefundsPanel } from './RefundsPanel'

/** Возвраты /admin/refunds (T-053). Данные и права — REST /api/cms/refunds. */
export function RefundsView(props: AdminViewServerProps) {
  const canEditPolicy = hasRole(props.initPageResult.req, REFUND_POLICY_ROLES)
  return (
    <AdminPage props={props} roles={REFUNDS_ROLES} path="/refunds">
      {({ apiUrl }) => (
        <RefundsPanel apiUrl={`${apiUrl}/cms/refunds`} canEditPolicy={canEditPolicy} />
      )}
    </AdminPage>
  )
}
