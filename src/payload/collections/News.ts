import {
  AlignFeature,
  BlockquoteFeature,
  BlocksFeature,
  BoldFeature,
  FixedToolbarFeature,
  HeadingFeature,
  HorizontalRuleFeature,
  InlineToolbarFeature,
  ItalicFeature,
  LinkFeature,
  OrderedListFeature,
  ParagraphFeature,
  StrikethroughFeature,
  UnderlineFeature,
  UnorderedListFeature,
  UploadFeature,
  lexicalEditor,
} from '@payloadcms/richtext-lexical'
import type { Block, CollectionConfig } from 'payload'

import { videoEmbedUrl } from '../../modules/content/embed'
import { hasRichText } from '../../modules/content/richText'
import { MediaUploadFeature } from '../lexical/MediaUploadFeature'

import { contentAccess } from '../access/roles'
import { RU_DATE_ONLY, imageFields, seoField, slugField, withTabNav } from '../fields'

type HrefValidateArgs = { siblingData?: { body?: unknown } }

/** Новости и анонсы (главная, /news). */
/** Блок текста новости: видео с YouTube, VK Видео или Rutube по ссылке (плеер на странице). */
const videoEmbedBlock: Block = {
  slug: 'videoEmbed',
  interfaceName: 'NewsVideoEmbedBlock',
  labels: { singular: 'Видео по ссылке (YouTube, VK, Rutube)', plural: 'Видео по ссылке' },
  fields: [
    {
      name: 'url',
      type: 'text',
      label: 'Ссылка на видео',
      required: true,
      validate: (v: string | null | undefined) =>
        (!!v && videoEmbedUrl(v) !== null) ||
        'Ссылка на страницу видео на YouTube, VK Видео или Rutube (https://…)',
      admin: {
        placeholder: 'https://youtu.be/…',
        description: 'Скопируйте адрес страницы с видео из браузера.',
      },
    },
    { name: 'caption', type: 'text', label: 'Подпись под видео' },
  ],
}

/** Блок текста новости: заметная кнопка-ссылка («Купить билет», «Подробнее о спектакле»). */
const buttonBlock: Block = {
  slug: 'button',
  interfaceName: 'NewsButtonBlock',
  labels: { singular: 'Кнопка-ссылка', plural: 'Кнопки' },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'label',
          type: 'text',
          label: 'Надпись',
          required: true,
          defaultValue: 'Купить билет',
          admin: { width: '40%' },
        },
        {
          name: 'href',
          type: 'text',
          label: 'Куда ведёт',
          required: true,
          validate: (v: string | null | undefined) =>
            (!!v && /^(\/[^\s]*|https:\/\/[^\s]+)$/.test(v)) ||
            'Адрес на сайте («/shows/guests») или https://…',
          admin: { placeholder: '/shows/guests', width: '60%' },
        },
      ],
    },
  ],
}

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
    // Вкладки только группируют форму (без name — данные лежат как раньше).
    {
      type: 'tabs',
      tabs: withTabNav([
        {
          label: 'Карточка в ленте',
          description: 'Как новость выглядит на главной и в архиве новостей.',
          fields: [
            {
              name: 'title',
              type: 'text',
              label: 'Заголовок',
              required: true,
              admin: { placeholder: 'Например: Премьера «Гости» 12 декабря' },
            },
            {
              name: 'summary',
              type: 'textarea',
              label: 'Короткий анонс',
              required: true,
              admin: {
                rows: 3,
                placeholder: 'Одно-два предложения: что, когда и где.',
                description: 'Текст под заголовком в карточке.',
              },
            },
            {
              name: 'tag',
              type: 'select',
              label: 'Метка на карточке',
              required: true,
              defaultValue: 'Анонс',
              options: [
                { value: 'Премьера', label: 'Премьера' },
                { value: 'Анонс', label: 'Анонс' },
              ],
              admin: { width: '50%' },
            },
            ...imageFields(
              'cover',
              'Обложка',
              'Картинка карточки и шапка страницы новости. Горизонтальная, 16:9.',
            ),
          ],
        },
        {
          label: 'Страница новости',
          description:
            'Необязательно. Напишите текст — у новости появится своя страница, карточка поведёт на неё. Не нужна страница — заполните только «Куда ведёт карточка».',
          fields: [
            {
              name: 'body',
              type: 'richText',
              label: 'Текст страницы',
              admin: {
                description:
                  'Заголовки, жирный, списки, цитаты, ссылки — на панели сверху. В «＋»: фото и видео с компьютера, видео по ссылке (YouTube, VK, Rutube), кнопка-ссылка, линия. Файл можно и перетащить в текст.',
              },
              // Панель инструментов сверху, как в Тильде; при выделении текста — ещё и всплывающая.
              editor: lexicalEditor({
                admin: { hideGutter: true, placeholder: 'Начните писать текст новости…' },
                features: () => [
                  ParagraphFeature(),
                  HeadingFeature({ enabledHeadingSizes: ['h2', 'h3'] }),
                  BoldFeature(),
                  ItalicFeature(),
                  UnderlineFeature(),
                  StrikethroughFeature(),
                  LinkFeature(),
                  UnorderedListFeature(),
                  OrderedListFeature(),
                  BlockquoteFeature(),
                  AlignFeature(),
                  UploadFeature(),
                  MediaUploadFeature(),
                  HorizontalRuleFeature(),
                  BlocksFeature({ blocks: [videoEmbedBlock, buttonBlock] }),
                  FixedToolbarFeature(),
                  InlineToolbarFeature(),
                ],
              }),
            },
            {
              name: 'href',
              type: 'text',
              label: 'Куда ведёт карточка (если текста нет)',
              // Нужна, только если у новости нет своего текста (иначе карточка ведёт на её страницу).
              validate: (v: string | null | undefined, { siblingData }: HrefValidateArgs) => {
                if (!v)
                  return (
                    hasRichText(siblingData?.body) ||
                    'Напишите текст страницы или укажите, куда ведёт карточка'
                  )
                return (
                  /^(\/[^\s]*|https:\/\/[^\s]+)$/.test(v) ||
                  'Адрес на сайте («/shows/guests») или https://…'
                )
              },
              admin: {
                placeholder: '/shows/guests',
                description:
                  'Страница спектакля или раздела: «/shows/guests», «/afisha». Если текст выше написан — не нужно.',
              },
            },
          ],
        },
        { label: 'Для поиска (SEO)', fields: [seoField] },
      ]),
    },
    {
      name: 'publishedAt',
      type: 'date',
      label: 'Дата новости',
      required: true,
      defaultValue: () => new Date().toISOString(),
      admin: { position: 'sidebar', date: RU_DATE_ONLY },
    },
    slugField('title', 'Адрес страницы', '/news'),
  ],
}
