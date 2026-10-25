import { ValidationError, type CollectionConfig } from 'payload'

import { contentAccess } from '../access/roles'
import { slugField, sortOrderField } from '../fields'

/** Отзывы о театре: текст дословно, автор и роль — как в материалах театра (rules.md §7). */
export const Reviews: CollectionConfig = {
  slug: 'reviews',
  labels: { singular: 'Отзыв', plural: 'Отзывы' },
  admin: { group: 'Контент', useAsTitle: 'author', defaultColumns: ['author', 'role', '_status'] },
  access: contentAccess,
  versions: { drafts: true, maxPerDoc: 20 },
  defaultSort: 'sortOrder',
  fields: [
    { name: 'author', type: 'text', label: 'Автор', required: true },
    slugField('author', 'Ключ'),
    { name: 'role', type: 'text', label: 'Кто автор', required: true },
    {
      name: 'lead',
      type: 'textarea',
      label: 'Выдержка для крупного набора',
      required: true,
      admin: { description: 'Дословная часть полного текста.' },
    },
    { name: 'quote', type: 'textarea', label: 'Полный текст', required: true },
    sortOrderField,
  ],
  hooks: {
    beforeValidate: [
      ({ data, req }) => {
        // Выдержка — дословная часть отзыва: иначе это уже не цитата.
        if (data?.lead && data?.quote && !String(data.quote).includes(String(data.lead)))
          throw new ValidationError({
            collection: 'reviews',
            errors: [{ path: 'lead', message: 'Выдержка должна дословно входить в полный текст' }],
            req,
          })
        return data
      },
    ],
  },
}
