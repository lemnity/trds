import type { CollectionConfig } from 'payload'

import { ADMIN_USERS_SLUG, nobody } from '../access/roles'
import { ADMIN_MFA_CODES_SLUG, ADMIN_MFA_SLUG } from '../auth/mfaStore'

// Секреты второго фактора: через REST/GraphQL недоступны никому, в админке не показываются.
// Читает и пишет только src/payload/auth (Local API с overrideAccess).
const closed = { read: nobody, create: nobody, update: nobody, delete: nobody }

export const AdminMfa: CollectionConfig = {
  slug: ADMIN_MFA_SLUG,
  admin: { hidden: true },
  access: closed,
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: ADMIN_USERS_SLUG,
      required: true,
      unique: true,
      index: true,
    },
    // Секрет TOTP, зашифрованный AES-256-GCM (src/payload/auth/mfa.ts).
    { name: 'secret', type: 'text' },
    { name: 'pendingSecret', type: 'text' },
    { name: 'lastStep', type: 'number' },
    { name: 'failedAttempts', type: 'number', defaultValue: 0 },
    { name: 'lockedUntil', type: 'date' },
    { name: 'enabledAt', type: 'date' },
  ],
}

export const AdminMfaRecoveryCodes: CollectionConfig = {
  slug: ADMIN_MFA_CODES_SLUG,
  admin: { hidden: true },
  access: closed,
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: ADMIN_USERS_SLUG,
      required: true,
      index: true,
    },
    // HMAC-SHA256 кода; сам код показывается сотруднику один раз.
    { name: 'hash', type: 'text', required: true, index: true },
    { name: 'usedAt', type: 'date' },
  ],
}
