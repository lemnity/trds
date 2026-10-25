import path from 'node:path'

import type { CollectionConfig } from 'payload'

import { anyone, contentEditors, isStaffAccess } from '../access/roles'

/**
 * Медиа (обложки, фото, портреты, логотипы). Сейчас — локальный диск (`MEDIA_DIR`, по умолчанию
 * ./media в корне проекта); production — S3 в РФ после выбора провайдера (src/payload/storage.ts).
 * Требования к обложке спектакля — design.md §11: 16:9, 1920×1080, JPEG/WebP до 300 КБ;
 * портрет человека — 3:4 (600×800). Точка фокуса задаётся в редакторе и попадает на сайт.
 */
export const Media: CollectionConfig = {
  slug: 'media',
  labels: { singular: 'Файл', plural: 'Медиа' },
  admin: { group: 'Контент', useAsTitle: 'alt' },
  access: {
    read: anyone,
    readVersions: isStaffAccess,
    create: contentEditors,
    update: contentEditors,
    delete: contentEditors,
  },
  upload: {
    staticDir: process.env.MEDIA_DIR ?? path.resolve(process.cwd(), 'media'),
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'application/pdf'],
    focalPoint: true,
    imageSizes: [
      { name: 'card', width: 736, withoutEnlargement: true },
      { name: 'cover', width: 1920, withoutEnlargement: true },
    ],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      label: 'Описание для незрячих',
      required: true,
      admin: { description: 'Что на картинке: «Сцена из спектакля „Гости“».' },
    },
    { name: 'credit', type: 'text', label: 'Автор фото / права' },
  ],
}
