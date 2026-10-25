import type { CollectionConfig } from 'payload'

import { EVENT_TYPE_LABELS } from '@/modules/shows'

import { contentAccess } from '../access/roles'
import {
  creditsField,
  galleryField,
  imageFields,
  paragraphsField,
  seoField,
  slugField,
  requireImageOnPublish,
} from '../fields'

/**
 * Спектакли (T-021). Поля сгруппированы по design.md §10: основное, описание и состав, медиа,
 * показы, SEO. Черновик на сайте не виден (drafts + доступ `publishedOrStaff`).
 */
export const Shows: CollectionConfig = {
  slug: 'shows',
  labels: { singular: 'Спектакль', plural: 'Спектакли' },
  admin: {
    group: 'Афиша',
    useAsTitle: 'title',
    defaultColumns: ['title', 'eventType', 'premiere', '_status'],
  },
  access: contentAccess,
  hooks: { beforeValidate: [requireImageOnPublish('shows', 'poster', 'Афиша')] },
  versions: { drafts: true, maxPerDoc: 30 },
  defaultSort: 'title',
  fields: [
    slugField(),
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Основное',
          fields: [
            { name: 'title', type: 'text', label: 'Название', required: true },
            {
              name: 'eventType',
              type: 'select',
              label: 'Формат',
              required: true,
              defaultValue: 'spectacle',
              options: Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => ({
                value,
                label,
              })),
            },
            { name: 'genre', type: 'text', label: 'Жанр' },
            {
              type: 'row',
              fields: [
                { name: 'ageLimit', type: 'number', label: 'Возраст, +', min: 0, max: 18 },
                { name: 'durationMinutes', type: 'number', label: 'Длительность, мин', min: 1 },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'premiere', type: 'checkbox', label: 'Премьера' },
                { name: 'pushkinCard', type: 'checkbox', label: 'Пушкинская карта' },
                { name: 'studentOffer', type: 'checkbox', label: 'Студенческие условия' },
              ],
            },
            {
              name: 'announcedAt',
              type: 'date',
              label: 'Дата анонса',
              admin: {
                date: { pickerAppearance: 'dayOnly' },
                description: 'Новее — раньше в слайдере главной. Пусто — дата создания записи.',
              },
            },
          ],
        },
        {
          label: 'Описание и состав',
          fields: [
            { name: 'lead', type: 'textarea', label: 'Анонс (1–2 предложения)', required: true },
            paragraphsField('description', 'Описание'),
            creditsField,
          ],
        },
        {
          label: 'Медиа',
          description:
            'Обложка — одна горизонтальная 16:9, 1920×1080, до 300 КБ, без дат и цен; главное — в центре (design.md §11).',
          fields: [
            ...imageFields('poster', 'Афиша (16:9)'),
            ...imageFields('cover', 'Обложка страницы', 'Нет — первое фото галереи, иначе афиша.'),
            {
              name: 'coverFocus',
              type: 'text',
              label: 'Фокус обложки (CSS object-position)',
              admin: { description: 'Например «50% 85%». Пусто — точка фокуса из «Медиа».' },
            },
            ...imageFields('preview', 'Превью карточки (368×250)', 'Нет — карточка берёт афишу.'),
            galleryField(),
          ],
        },
        {
          label: 'Показы',
          fields: [
            {
              name: 'performances',
              type: 'join',
              collection: 'performances',
              on: 'show',
              label: 'Показы',
              admin: { defaultColumns: ['startsAt', 'venue', '_status'] },
            },
          ],
        },
        { label: 'SEO', fields: [seoField] },
      ],
    },
  ],
}
