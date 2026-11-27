import type { CollectionConfig } from 'payload'

import { EVENT_TYPE_LABELS } from '@/modules/shows'

import { contentAccess } from '../access/roles'
import { guardShowDelete } from '../hooks/inventorySync'
import { refreshPerformanceTitles } from '../hooks/performanceTitle'
import {
  RU_DATE_ONLY,
  castField,
  creditsField,
  galleryField,
  imageFields,
  paragraphsField,
  seoField,
  slugField,
  requireImageOnPublish,
  withTabNav,
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
  hooks: {
    beforeValidate: [requireImageOnPublish('shows', 'poster', 'Афиша')],
    afterChange: [refreshPerformanceTitles('show')],
    beforeDelete: [guardShowDelete],
  },
  versions: { drafts: true, maxPerDoc: 30 },
  defaultSort: 'title',
  fields: [
    slugField(),
    // Даты, площадки и билеты — в «Показах»; здесь только ссылка на показы спектакля.
    {
      name: 'performancesLink',
      type: 'ui',
      admin: {
        position: 'sidebar',
        components: {
          Field: '/payload/components/shows/ShowPerformancesLink#ShowPerformancesLink',
        },
      },
    },
    {
      type: 'tabs',
      tabs: withTabNav([
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
            { name: 'lead', type: 'textarea', label: 'Анонс (1–2 предложения)', required: true },
            {
              name: 'announcedAt',
              type: 'date',
              label: 'Дата анонса',
              admin: {
                date: RU_DATE_ONLY,
                description: 'Новее — раньше в слайдере главной. Пусто — дата создания записи.',
              },
            },
          ],
        },
        {
          label: 'Описание и состав',
          fields: [paragraphsField('description', 'Описание'), creditsField, castField],
        },
        {
          label: 'Медиа',
          description:
            'Обложка — одна горизонтальная 16:9, 1920×1080, до 300 КБ, без дат и цен; главное — в центре (design.md §11).',
          fields: [
            ...imageFields('poster', 'Афиша (16:9)'),
            ...imageFields('cover', 'Обложка страницы', 'Нет — первое фото галереи, иначе афиша.'),
            {
              // Значение — CSS object-position «X% Y%»; выбирается щелчком по картинке.
              name: 'coverFocus',
              type: 'text',
              label: 'Фокус обложки',
              validate: (v: string | null | undefined) =>
                !v || /^\d+(\.\d+)?% \d+(\.\d+)?%$/.test(v) || 'Точка в процентах: «50% 85%»',
              admin: {
                components: {
                  Field: '/payload/components/shows/CoverFocusField#CoverFocusField',
                },
              },
            },
            ...imageFields('preview', 'Превью карточки (368×250)', 'Нет — карточка берёт афишу.'),
            ...galleryField(),
          ],
        },
        { label: 'SEO', fields: [seoField] },
      ]),
    },
  ],
}
