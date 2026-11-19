import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'

import { HALL_PLAN_OPTIONS, validateSeatPricing } from '@/modules/seating'
import { THEATRE_TIME_ZONE } from '@/modules/shows'

import { contentAccess, fieldTheatreAdmins, theatreAdmins } from '../access/roles'
import { codeField } from '../fields'
import {
  PERFORMANCES_SLUG,
  TICKET_TYPES_SLUG,
  guardPerformanceDelete,
  syncPerformanceSeating,
} from '../hooks/inventorySync'
import { setPerformanceTitle } from '../hooks/performanceTitle'

/**
 * Дата и время в админке: react-datepicker разбирает ввод тем же форматом, что и показывает,
 * поэтому без displayFormat ручной ввод «15.03.2027 19:00» не принимался (формат по умолчанию — американский 12-часовой).
 */
export const RU_DATE_TIME = {
  pickerAppearance: 'dayAndTime',
  displayFormat: 'dd.MM.yyyy HH:mm',
  timeFormat: 'HH:mm',
  timeIntervals: 15,
} as const

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
    useAsTitle: 'title',
    defaultColumns: ['title', 'startsAt', 'venue', '_status'],
  },
  access: { ...contentAccess, delete: theatreAdmins },
  versions: { drafts: true, maxPerDoc: 30 },
  defaultSort: 'startsAt',
  hooks: {
    beforeValidate: [defaultCode],
    beforeChange: [setPerformanceTitle],
    afterChange: [syncPerformanceSeating()],
    beforeDelete: [guardPerformanceDelete()],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      label: 'Название',
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Собирается само: спектакль · дата и время · площадка.',
      },
    },
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
        date: RU_DATE_TIME,
        description: 'Время — екатеринбургское (часовой пояс браузера должен совпадать).',
      },
    },
    {
      name: 'seating',
      type: 'group',
      label: 'Схема зала и цены мест',
      access: { create: fieldTheatreAdmins, update: fieldTheatreAdmins },
      admin: {
        description:
          'Выберите площадку — появится её зал. Выделите места и назначьте им ценовую зону. Только администратор театра.',
      },
      fields: [
        {
          name: 'planId',
          type: 'select',
          label: 'Схема',
          options: HALL_PLAN_OPTIONS,
          admin: {
            description: 'Подставляется из площадки. Пусто — продажа по категориям без мест.',
          },
        },
        {
          name: 'pricing',
          type: 'json',
          label: 'Цены по схеме зала',
          validate: (
            value: unknown,
            { siblingData }: { siblingData?: { planId?: string | null } },
          ) => validateSeatPricing(value, siblingData?.planId),
          admin: {
            components: {
              Field: {
                path: '/payload/components/seating/SeatPricingField#SeatPricingField',
                clientProps: {
                  planPath: 'seating.planId',
                  venuePath: 'venue',
                  closedPath: 'seating.unavailableSeatIds',
                  templates: true,
                },
              },
            },
          },
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
          admin: {
            hidden: true,
            description: 'Отмечаются на схеме: «Закрыть с продажи».',
          },
        },
      ],
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
              admin: { date: RU_DATE_TIME },
            },
            {
              name: 'salesEndAt',
              type: 'date',
              label: 'Продажи до',
              access: { create: fieldTheatreAdmins, update: fieldTheatreAdmins },
              admin: {
                date: RU_DATE_TIME,
                description: 'Пусто — до начала показа.',
              },
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
