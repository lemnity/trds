import type { CollectionConfig } from 'payload'

import { contentAccess } from '../access/roles'
import { sortOrderField } from '../fields'

/** Партнёры и площадки. Список и логотипы подтверждает театр. */
export const Partners: CollectionConfig = {
  slug: 'partners',
  labels: { singular: 'Партнёр', plural: 'Партнёры' },
  admin: { group: 'Контент', useAsTitle: 'name', defaultColumns: ['name', 'role', '_status'] },
  access: contentAccess,
  versions: { drafts: true, maxPerDoc: 10 },
  defaultSort: 'sortOrder',
  fields: [
    { name: 'name', type: 'text', label: 'Название', required: true },
    { name: 'role', type: 'text', label: 'Кто для театра', required: true },
    { name: 'logo', type: 'upload', relationTo: 'media', label: 'Логотип' },
    {
      name: 'url',
      type: 'text',
      label: 'Сайт',
      validate: (v: string | null | undefined) => !v || /^https:\/\/\S+$/.test(v) || 'https://…',
    },
    sortOrderField,
  ],
}
