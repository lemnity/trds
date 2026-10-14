import type { CollectionConfig } from 'payload'

// Минимальная коллекция для работы Payload Admin. Роли и MFA — задача T-023.
export const AdminUsers: CollectionConfig = {
  slug: 'admin-users',
  admin: {
    useAsTitle: 'email',
  },
  auth: true,
  fields: [],
}
