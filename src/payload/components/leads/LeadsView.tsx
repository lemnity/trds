import type { AdminViewServerProps } from 'payload'

import { LEADS_ROLES } from '../../endpoints/leads'
import { AdminPage } from '../AdminPage'
import { LeadsBoard } from './LeadsBoard'

/** Канбан корпоративов /admin/leads (T-065). Данные и права — REST /api/cms/leads. */
export function LeadsView(props: AdminViewServerProps) {
  return (
    <AdminPage props={props} roles={LEADS_ROLES} path="/leads">
      {({ apiUrl }) => <LeadsBoard apiUrl={`${apiUrl}/cms/leads`} />}
    </AdminPage>
  )
}
