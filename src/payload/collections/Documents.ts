import type { CollectionConfig } from 'payload'

import { contentAccess } from '../access/roles'
import { paragraphsField, slugField, sortOrderField } from '../fields'

/**
 * Юридические документы (T-022): ПД, политика, cookie, соглашение, возвраты, реквизиты. Тексты
 * — только переданные театром; пока текста нет, сайт честно пишет, что документ готовится.
 */
export const Documents: CollectionConfig = {
  slug: 'documents',
  labels: { singular: 'Документ', plural: 'Документы' },
  admin: { group: 'Контент', useAsTitle: 'title', defaultColumns: ['title', 'slug', '_status'] },
  access: contentAccess,
  versions: { drafts: true, maxPerDoc: 30 },
  defaultSort: 'sortOrder',
  fields: [
    { name: 'title', type: 'text', label: 'Название', required: true },
    slugField(),
    paragraphsField('body', 'Текст документа'),
    { name: 'file', type: 'upload', relationTo: 'media', label: 'PDF-версия' },
    sortOrderField,
  ],
}
