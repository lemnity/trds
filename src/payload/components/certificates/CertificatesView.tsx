import type { AdminViewServerProps } from 'payload'

import { CERTIFICATES_ROLES } from '../../endpoints/certificates'
import { AdminPage } from '../AdminPage'
import { CertificatesAdmin } from './CertificatesAdmin'

/** Подарочные сертификаты /admin/certificates (T-066). Данные и права — REST /api/cms/certificates. */
export function CertificatesView(props: AdminViewServerProps) {
  return (
    <AdminPage props={props} roles={CERTIFICATES_ROLES} path="/certificates">
      {({ apiUrl }) => <CertificatesAdmin apiUrl={`${apiUrl}/cms/certificates`} />}
    </AdminPage>
  )
}
