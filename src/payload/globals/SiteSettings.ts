import type { GlobalConfig } from 'payload'

import { anyone, isStaffAccess, theatreAdmins } from '../access/roles'

/**
 * Настройки сайта (T-022): контакты, соцсети, часы офиса, слоган, SEO по умолчанию. Правит
 * только администратор театра. Секретов интеграций здесь нет и быть не должно — они только в
 * окружении сервера (plan-main.md §7.4).
 */
export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'Настройки сайта',
  admin: { group: 'Администрирование' },
  access: { read: anyone, readVersions: isStaffAccess, update: theatreAdmins },
  versions: { drafts: false, max: 30 },
  fields: [
    { name: 'theatreName', type: 'text', label: 'Название театра', required: true },
    { name: 'slogan', type: 'text', label: 'Слоган' },
    {
      name: 'contacts',
      type: 'group',
      label: 'Контакты',
      fields: [
        {
          name: 'phone',
          type: 'text',
          label: 'Телефон',
          required: true,
          validate: (v: string | null | undefined) =>
            (!!v && v.replace(/\D/g, '').length === 11) || 'Номер из 11 цифр: +7 982 657-54-26',
        },
        { name: 'email', type: 'email', label: 'Почта', required: true },
        { name: 'officeAddress', type: 'text', label: 'Адрес офиса', required: true },
        { name: 'officeShort', type: 'text', label: 'Адрес офиса кратко', required: true },
        { name: 'hours', type: 'text', label: 'Часы работы', required: true },
        {
          name: 'mapUrl',
          type: 'text',
          label: 'Ссылка на карту',
          validate: (v: string | null | undefined) =>
            !v || /^https:\/\/\S+$/.test(v) || 'https://…',
        },
      ],
    },
    {
      name: 'social',
      type: 'array',
      label: 'Соцсети',
      fields: [
        { name: 'name', type: 'text', label: 'Сеть', required: true },
        { name: 'handle', type: 'text', label: 'Аккаунт', required: true },
        {
          name: 'href',
          type: 'text',
          label: 'Ссылка',
          required: true,
          validate: (v: string | null | undefined) =>
            (!!v && /^https:\/\/\S+$/.test(v)) || 'https://…',
        },
      ],
    },
    {
      name: 'seo',
      type: 'group',
      label: 'SEO по умолчанию',
      fields: [
        { name: 'title', type: 'text', label: 'Заголовок сайта', maxLength: 70 },
        { name: 'description', type: 'textarea', label: 'Описание сайта', maxLength: 300 },
        { name: 'image', type: 'upload', relationTo: 'media', label: 'Картинка для ссылок' },
      ],
    },
  ],
}
