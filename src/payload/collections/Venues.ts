import type { CollectionConfig } from 'payload'

import { VENUE_KIND_LABELS } from '@/modules/shows'

import { contentAccess } from '../access/roles'
import { codeField, seoField, sortOrderField } from '../fields'

/** Площадки (T-021). Ключ совпадает с id площадки в схемах залов (`dom-aktera`, `dk`). */
export const Venues: CollectionConfig = {
  slug: 'venues',
  labels: { singular: 'Площадка', plural: 'Площадки' },
  admin: { group: 'Афиша', useAsTitle: 'title', defaultColumns: ['title', 'kind', 'address'] },
  access: contentAccess,
  versions: { drafts: true, maxPerDoc: 20 },
  defaultSort: 'sortOrder',
  fields: [
    codeField('Латиницей, не меняется после первых продаж: «dk», «dom-aktera».'),
    { name: 'title', type: 'text', label: 'Название', required: true },
    {
      name: 'kind',
      type: 'select',
      label: 'Тип',
      required: true,
      options: Object.entries(VENUE_KIND_LABELS).map(([value, label]) => ({ value, label })),
    },
    { name: 'address', type: 'text', label: 'Адрес', required: true },
    {
      type: 'row',
      fields: [
        { name: 'lat', type: 'number', label: 'Широта' },
        { name: 'lon', type: 'number', label: 'Долгота' },
      ],
    },
    { name: 'directions', type: 'textarea', label: 'Как добраться' },
    { name: 'accessibilityNotes', type: 'textarea', label: 'Доступная среда' },
    sortOrderField,
    seoField,
  ],
}
