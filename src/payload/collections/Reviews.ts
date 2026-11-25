import { ValidationError, type CollectionConfig, type TextField } from 'payload'

import { contentAccess } from '../access/roles'
import { slugField } from '../fields'

/**
 * Отзывы: текст дословно, автор и роль — как в материалах театра (rules.md §7).
 * Все отзывы — на главной; привязанные к спектаклю или людям — ещё и на их страницах.
 */
export const Reviews: CollectionConfig = {
  slug: 'reviews',
  labels: { singular: 'Отзыв', plural: 'Отзывы' },
  admin: {
    group: 'Контент',
    useAsTitle: 'author',
    defaultColumns: ['author', 'role', 'show', 'createdAt', '_status'],
  },
  access: contentAccess,
  versions: { drafts: true, maxPerDoc: 20 },
  // На сайте и в списке — от новых к старым.
  defaultSort: '-createdAt',
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'author',
          type: 'text',
          label: 'Автор',
          required: true,
          admin: { placeholder: 'Имя и фамилия', width: '50%' },
        },
        {
          name: 'role',
          type: 'text',
          label: 'Кто автор',
          required: true,
          admin: { placeholder: 'Например: зритель, журналист', width: '50%' },
        },
      ],
    },
    {
      name: 'quote',
      type: 'textarea',
      label: 'Текст отзыва',
      required: true,
      admin: { rows: 8, description: 'Дословно, как прислал автор.' },
    },
    {
      name: 'lead',
      type: 'textarea',
      label: 'Цитата крупно',
      required: true,
      admin: {
        rows: 2,
        description:
          'Одна яркая фраза из текста отзыва — крупным шрифтом на сайте. Скопируйте её из текста выше слово в слово.',
      },
    },
    {
      name: 'show',
      type: 'relationship',
      relationTo: 'shows',
      label: 'Спектакль',
      admin: {
        position: 'sidebar',
        description: 'Отзыв появится и на странице этого спектакля. Пусто — отзыв о театре.',
      },
    },
    {
      name: 'people',
      type: 'relationship',
      relationTo: 'people',
      hasMany: true,
      label: 'О ком отзыв',
      admin: {
        position: 'sidebar',
        description: 'Отзыв появится и на страницах этих людей. Можно выбрать нескольких.',
      },
    },
    // Служебный ключ (id отзыва на сайте): заполняется из имени автора, в форме не нужен.
    { ...(slugField('author', 'Ключ') as TextField), admin: { hidden: true } },
  ],
  hooks: {
    beforeValidate: [
      ({ data, req }) => {
        // Выдержка — дословная часть отзыва: иначе это уже не цитата.
        if (data?.lead && data?.quote && !String(data.quote).includes(String(data.lead)))
          throw new ValidationError(
            {
              collection: 'reviews',
              errors: [
                {
                  path: 'lead',
                  label: 'Цитата крупно',
                  message: 'Цитата должна слово в слово совпадать с частью текста отзыва',
                },
              ],
              req,
            },
            req.t,
          )
        return data
      },
    ],
  },
}
