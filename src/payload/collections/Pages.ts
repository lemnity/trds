import type { CollectionConfig } from 'payload'

import { contentAccess } from '../access/roles'
import { galleryField, paragraphsField, seoField, slugField } from '../fields'

/**
 * Текстовые страницы (T-022): «О театре» (адрес `about`), «Корпоративы» (`corporate`) и
 * будущие. Остальная разметка страниц — в коде; сюда — тексты, фото и SEO.
 */
export const Pages: CollectionConfig = {
  slug: 'pages',
  labels: { singular: 'Страница', plural: 'Страницы' },
  admin: { group: 'Контент', useAsTitle: 'title', defaultColumns: ['title', 'slug', '_status'] },
  access: contentAccess,
  versions: { drafts: true, maxPerDoc: 20 },
  fields: [
    { name: 'title', type: 'text', label: 'Заголовок', required: true },
    slugField(),
    { name: 'lead', type: 'textarea', label: 'Подзаголовок / слоган' },
    paragraphsField('body', 'Текст'),
    galleryField('photos', 'Фото'),
    seoField,
  ],
}
