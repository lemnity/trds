import type { CollectionConfig } from 'payload'

import { contentAccess } from '../access/roles'
import { imageFields, paragraphsField, seoField, slugField, sortOrderField } from '../fields'

/**
 * Люди театра (T-025): актёры, режиссёры, руководство, педагоги. Связаны с составами спектаклей
 * и архива. Портреты и биографии — только переданные театром (rules.md §7).
 */
export const People: CollectionConfig = {
  slug: 'people',
  labels: { singular: 'Человек', plural: 'Люди' },
  admin: {
    group: 'Контент',
    useAsTitle: 'name',
    defaultColumns: ['name', 'position', 'leadership', '_status'],
  },
  access: contentAccess,
  versions: { drafts: true, maxPerDoc: 20 },
  defaultSort: 'name',
  fields: [
    { name: 'name', type: 'text', label: 'Имя и фамилия', required: true },
    slugField('name'),
    {
      name: 'portrait',
      type: 'upload',
      relationTo: 'media',
      label: 'Портрет 3:4',
      admin: { description: '600×800, лицо в верхней трети кадра.' },
    },
    { name: 'position', type: 'text', label: 'Должность' },
    {
      name: 'bioTitle',
      type: 'text',
      label: 'Подзаголовок биографии',
      admin: { description: 'Пусто — должность.' },
    },
    paragraphsField('bio', 'Биография'),
    {
      name: 'works',
      type: 'array',
      label: 'Работы',
      labels: { singular: 'Работа', plural: 'Работы' },
      fields: [{ name: 'title', type: 'text', label: 'Название', required: true }],
    },
    {
      name: 'quote',
      type: 'group',
      label: 'Цитата',
      fields: [
        { name: 'text', type: 'textarea', label: 'Текст (дословно)' },
        { name: 'about', type: 'text', label: 'О чём — «о спектакле „…“»' },
      ],
    },
    ...imageFields('slide', 'Кадр для слайд-шоу'),
    {
      name: 'leadership',
      type: 'checkbox',
      label: 'Руководство театра',
      admin: { position: 'sidebar', description: 'Показывать на странице «Руководство».' },
    },
    sortOrderField,
    {
      name: 'source',
      type: 'text',
      label: 'Источник текста',
      admin: { position: 'sidebar', description: 'Где театр опубликовал биографию.' },
    },
    seoField,
  ],
}
