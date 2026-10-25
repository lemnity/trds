import type { CollectionConfig } from 'payload'

import { contentAccess } from '../access/roles'
import {
  creditsField,
  imageFields,
  requireImageOnPublish,
  slugField,
  sortOrderField,
} from '../fields'

/** Архив постановок (T-026): прошедшие спектакли без показов и продаж — афиша и состав. */
export const Archive: CollectionConfig = {
  slug: 'archive',
  labels: { singular: 'Постановка архива', plural: 'Архив постановок' },
  admin: { group: 'Афиша', useAsTitle: 'title', defaultColumns: ['title', 'genre', '_status'] },
  access: contentAccess,
  hooks: { beforeValidate: [requireImageOnPublish('archive', 'poster', 'Афиша')] },
  versions: { drafts: true, maxPerDoc: 20 },
  defaultSort: 'sortOrder',
  fields: [
    { name: 'title', type: 'text', label: 'Название', required: true },
    slugField(),
    { name: 'genre', type: 'text', label: 'Жанр' },
    ...imageFields('poster', 'Афиша'),
    creditsField,
    sortOrderField,
  ],
}
