import type { CollectionConfig } from 'payload'

import { contentAccess } from '../access/roles'
import { imageFields, paragraphsField, seoField, slugField } from '../fields'

/** Новости и анонсы (главная, /news). */
export const News: CollectionConfig = {
  slug: 'news',
  labels: { singular: 'Новость', plural: 'Новости' },
  admin: {
    group: 'Контент',
    useAsTitle: 'title',
    defaultColumns: ['title', 'tag', 'publishedAt', '_status'],
  },
  access: contentAccess,
  versions: { drafts: true, maxPerDoc: 20 },
  defaultSort: '-publishedAt',
  fields: [
    { name: 'title', type: 'text', label: 'Заголовок', required: true },
    slugField(),
    {
      name: 'tag',
      type: 'select',
      label: 'Метка',
      required: true,
      defaultValue: 'Анонс',
      options: [
        { value: 'Премьера', label: 'Премьера' },
        { value: 'Анонс', label: 'Анонс' },
      ],
    },
    { name: 'summary', type: 'textarea', label: 'Анонс', required: true },
    paragraphsField('body', 'Текст'),
    ...imageFields('cover', 'Обложка'),
    {
      name: 'href',
      type: 'text',
      label: 'Ссылка',
      required: true,
      validate: (v: string | null | undefined) =>
        (!!v && /^(\/[^\s]*|https:\/\/[^\s]+)$/.test(v)) ||
        'Адрес на сайте («/shows/guests») или https://…',
      admin: { description: 'Куда ведёт карточка: «/shows/guests», «/afisha?kind=bar».' },
    },
    {
      name: 'publishedAt',
      type: 'date',
      label: 'Дата',
      required: true,
      defaultValue: () => new Date().toISOString(),
      admin: { position: 'sidebar', date: { pickerAppearance: 'dayOnly' } },
    },
    seoField,
  ],
}
