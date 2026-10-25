import {
  ValidationError,
  type CollectionBeforeValidateHook,
  type Field,
  type TextFieldSingleValidation,
} from 'payload'

import { personSlug } from '@/modules/people'

/**
 * Общие поля коллекций контента. Тексты — обычные строки (абзацы через пустую строку), без
 * HTML: сайт выводит их как текст, санитизация на границе CMS не нужна (rules.md §4).
 */

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const validSlug: TextFieldSingleValidation = (value) =>
  !value || SLUG_PATTERN.test(value) || 'Только латиница, цифры и дефис: «crime-punishment»'

/** Адрес страницы: латиница; пусто — из названия (транслитерация, как у людей театра). */
export const slugField = (from = 'title', label = 'Адрес страницы'): Field => ({
  name: 'slug',
  type: 'text',
  label,
  unique: true,
  index: true,
  validate: validSlug,
  admin: {
    position: 'sidebar',
    description: 'Часть адреса: /shows/<адрес>. Пусто — заполнится из названия.',
  },
  hooks: {
    beforeValidate: [
      ({ value, siblingData }) =>
        value || (typeof siblingData?.[from] === 'string' ? personSlug(siblingData[from]) : value),
    ],
  },
})

/** Стабильный ключ записи (id показа, площадки, категории) — на него ссылаются заказы. */
export const codeField = (
  description: string,
  { required = true, immutable = false }: { required?: boolean; immutable?: boolean } = {},
): Field => ({
  name: 'code',
  type: 'text',
  label: 'Ключ',
  required,
  unique: true,
  index: true,
  validate: validSlug,
  ...(immutable && { access: { update: () => false } }),
  admin: { position: 'sidebar', description },
})

/** Абзацы текста: пустая строка — новый абзац. */
export const paragraphsField = (name: string, label: string, required = false): Field => ({
  name,
  type: 'textarea',
  label,
  required,
  admin: { description: 'Новый абзац — через пустую строку.', rows: 8 },
})

/**
 * Изображение: файл из «Медиа» или временный адрес на CDN старого сайта (до переноса медиа,
 * T-024). Сайт берёт файл, если он есть.
 */
export const imageFields = (name: string, label: string, description?: string): Field[] => [
  {
    name,
    type: 'upload',
    relationTo: 'media',
    label,
    admin: description ? { description } : undefined,
  },
  {
    name: `${name}Url`,
    type: 'text',
    label: `${label}: адрес на старом сайте`,
    admin: {
      description:
        'Только до загрузки файла в «Медиа»: https://static.tildacdn.com/… или /posters/…',
    },
    validate: (value: string | null | undefined) =>
      !value || /^(https:\/\/|\/)[^\s]+$/.test(value) || 'Адрес https://… или /путь',
  },
]

export const galleryField = (name = 'gallery', label = 'Фото'): Field => ({
  name,
  type: 'array',
  label,
  labels: { singular: 'Фото', plural: 'Фото' },
  fields: imageFields('image', 'Файл'),
})

export const seoField: Field = {
  name: 'seo',
  type: 'group',
  label: 'SEO',
  fields: [
    { name: 'title', type: 'text', label: 'Заголовок для поиска', maxLength: 70 },
    { name: 'description', type: 'textarea', label: 'Описание для поиска', maxLength: 300 },
    { name: 'image', type: 'upload', relationTo: 'media', label: 'Картинка для ссылки' },
  ],
}

/** Состав: строка («Режиссёр», «В ролях») → персонажи → люди (несколько — играют в очередь). */
export const creditsField: Field = {
  name: 'credits',
  type: 'array',
  label: 'Состав и создатели',
  labels: { singular: 'Строка состава', plural: 'Состав' },
  fields: [
    { name: 'role', type: 'text', label: 'Строка', required: true },
    {
      name: 'entries',
      type: 'array',
      label: 'Кто',
      fields: [
        { name: 'character', type: 'text', label: 'Персонаж (для актёров)' },
        {
          name: 'people',
          type: 'relationship',
          relationTo: 'people',
          hasMany: true,
          required: true,
          label: 'Люди',
          admin: { description: 'Несколько человек — состав в очередь.' },
        },
      ],
    },
  ],
}

export const sortOrderField: Field = {
  name: 'sortOrder',
  type: 'number',
  label: 'Порядок',
  defaultValue: 0,
  admin: { position: 'sidebar', description: 'Меньше — выше в списке.' },
}

/**
 * Опубликовать без картинки нельзя: карточки, слайдер и ссылка в мессенджере без неё пустые.
 * Черновик сохраняется и без афиши.
 */
export const requireImageOnPublish =
  (collection: string, name: string, label: string): CollectionBeforeValidateHook =>
  ({ data, originalDoc, req }) => {
    const merged = { ...originalDoc, ...data }
    if (merged._status === 'published' && !merged[name] && !merged[`${name}Url`])
      throw new ValidationError({
        collection,
        errors: [{ path: name, message: `${label}: загрузите файл или укажите адрес` }],
        req,
      })
    return data
  }
