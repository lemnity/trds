import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'

import { domAkteraPlan, domKulturyPlan } from '@/modules/seating'
import { THEATRE_TIME_ZONE } from '@/modules/shows'

import { contentAccess, fieldTheatreAdmins, theatreAdmins } from '../access/roles'
import { codeField } from '../fields'
import {
  PERFORMANCES_SLUG,
  TICKET_TYPES_SLUG,
  guardPerformanceDelete,
  syncPerformanceSeating,
} from '../hooks/inventorySync'

const PLANS = [domAkteraPlan, domKulturyPlan]

const dayTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: THEATRE_TIME_ZONE,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Ключ показа по умолчанию: «guests-1101-1800» (адрес спектакля, дата и время театра). */
const defaultCode: CollectionBeforeValidateHook = async ({ data, req, operation }) => {
  if (operation !== 'create' || !data || data.code || !data.show || !data.startsAt) return data
  const show = await req.payload.findByID({
    collection: 'shows',
    id: data.show as number,
    depth: 0,
    draft: true,
    overrideAccess: true,
    req,
  })
  const parts = Object.fromEntries(
    dayTime.formatToParts(new Date(data.startsAt as string)).map((p) => [p.type, p.value]),
  )
  return {
    ...data,
    code: `${show.slug}-${parts.month}${parts.day}-${parts.hour}${parts.minute}`,
  }
}

/**
 * Показы (T-021). Дата хранится в UTC, на сайте — время театра. Редактор ставит спектакль,
 * площадку и дату; окно продаж, схему зала и цены мест — только администратор театра.
 * Цены и квоты категорий — коллекция «Категории билетов».
 */
export const Performances: CollectionConfig = {
  slug: PERFORMANCES_SLUG,
  labels: { singular: 'Показ', plural: 'Показы' },
  admin: {
    group: 'Афиша',
    useAsTitle: 'code',
    defaultColumns: ['code', 'show', 'startsAt', 'venue', '_status'],
  },
  access: { ...contentAccess, delete: theatreAdmins },
  versions: { drafts: true, maxPerDoc: 30 },
  defaultSort: 'startsAt',
  hooks: {
    beforeValidate: [defaultCode],
    afterChange: [syncPerformanceSeating()],
    beforeDelete: [guardPerformanceDelete],
  },
  fields: [
    codeField('Не меняется: на него ссылаются заказы и билеты. Пусто — заполнится сам.', {
      required: false,
      immutable: true,
    }),
    { name: 'show', type: 'relationship', relationTo: 'shows', label: 'Спектакль', required: true },
    {
      name: 'venue',
      type: 'relationship',
      relationTo: 'venues',
      label: 'Площадка',
      required: true,
    },
    {
      name: 'startsAt',
      type: 'date',
      label: 'Начало',
      required: true,
      index: true,
      admin: {
        date: { pickerAppearance: 'dayAndTime', timeFormat: 'HH:mm', timeIntervals: 15 },
        description: 'Время — екатеринбургское (часовой пояс браузера должен совпадать).',
      },
    },
    {
      type: 'collapsible',
      label: 'Продажи',
      admin: {
        description:
          'Только администратор театра. Вместимость нельзя поставить ниже уже проданного и забронированного — сохранение будет отклонено.',
      },
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'salesStartAt',
              type: 'date',
              label: 'Продажи с',
              access: { create: fieldTheatreAdmins, update: fieldTheatreAdmins },
              admin: { date: { pickerAppearance: 'dayAndTime', timeFormat: 'HH:mm' } },
            },
            {
              name: 'salesEndAt',
              type: 'date',
              label: 'Продажи до',
              access: { create: fieldTheatreAdmins, update: fieldTheatreAdmins },
              admin: {
                date: { pickerAppearance: 'dayAndTime', timeFormat: 'HH:mm' },
                description: 'Пусто — до начала показа.',
              },
            },
          ],
        },
        {
          name: 'seating',
          type: 'group',
          label: 'Схема зала',
          access: { create: fieldTheatreAdmins, update: fieldTheatreAdmins },
          fields: [
            {
              name: 'planId',
              type: 'select',
              label: 'Схема',
              options: PLANS.map((p) => ({ value: p.id, label: p.title })),
              admin: { description: 'Пусто — продажа по категориям без мест.' },
            },
            {
              name: 'prices',
              type: 'array',
              label: 'Цены категорий мест',
              admin: {
                description: 'В копейках: 1 000 ₽ = 100000. Категория без цены не продаётся.',
              },
              fields: [
                { name: 'categoryId', type: 'text', label: 'Категория', required: true },
                {
                  name: 'priceKopecks',
                  type: 'number',
                  label: 'Цена, коп.',
                  required: true,
                  min: 0,
                  validate: (v: number | null | undefined) =>
                    (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) ||
                    'Целое число копеек',
                },
              ],
            },
            {
              name: 'pricesPlaceholder',
              type: 'checkbox',
              label: 'Цены не утверждены театром (на сайте — «предварительно»)',
            },
            {
              name: 'unavailableSeatIds',
              type: 'text',
              hasMany: true,
              label: 'Закрытые места',
              admin: { description: 'Технические и снятые с продажи места, например «p-1-5».' },
            },
          ],
        },
      ],
    },
    {
      name: 'ticketTypes',
      type: 'join',
      collection: TICKET_TYPES_SLUG,
      on: 'performance',
      label: 'Категории билетов',
      admin: { defaultColumns: ['title', 'priceKopecks', 'capacity'] },
    },
  ],
}
