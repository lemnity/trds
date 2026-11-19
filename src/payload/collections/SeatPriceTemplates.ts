import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'

import { HALL_PLAN_OPTIONS, validateSeatPricing } from '@/modules/seating'

import { isStaffAccess, theatreAdmins } from '../access/roles'

export const SEAT_PRICE_TEMPLATES_SLUG = 'seat-price-templates'

/** Схема не указана — схема зала площадки. */
const planFromVenue: CollectionBeforeValidateHook = async ({ data, req }) => {
  if (!data || data.planId || !data.venue) return data
  const venueId = typeof data.venue === 'object' ? data.venue.id : data.venue
  const venue = await req.payload.findByID({
    collection: 'venues',
    id: venueId,
    depth: 0,
    draft: true,
    overrideAccess: true,
    req,
  })
  return { ...data, planId: venue.seatingPlanId ?? undefined }
}

/**
 * Шаблоны цен зала: ценовые зоны и раскладка мест по схеме площадки. Создаются из карточки
 * площадки или показа («Сохранить как шаблон») и применяются к показу одной кнопкой —
 * в показ копируются, связи нет: правка шаблона не меняет уже настроенные показы.
 */
export const SeatPriceTemplates: CollectionConfig = {
  slug: SEAT_PRICE_TEMPLATES_SLUG,
  labels: { singular: 'Шаблон цен зала', plural: 'Шаблоны цен зала' },
  admin: {
    group: 'Продажи',
    useAsTitle: 'title',
    defaultColumns: ['title', 'venue', 'planId', 'updatedAt'],
    description: 'Удобнее править в карточке площадки: «Схема зала и шаблоны цен».',
  },
  access: {
    read: isStaffAccess,
    create: theatreAdmins,
    update: theatreAdmins,
    delete: theatreAdmins,
  },
  defaultSort: 'title',
  hooks: { beforeValidate: [planFromVenue] },
  fields: [
    { name: 'title', type: 'text', label: 'Название', required: true },
    {
      type: 'row',
      fields: [
        {
          name: 'venue',
          type: 'relationship',
          relationTo: 'venues',
          label: 'Площадка',
          required: true,
          index: true,
        },
        {
          name: 'planId',
          type: 'select',
          label: 'Схема зала',
          required: true,
          index: true,
          options: HALL_PLAN_OPTIONS,
          admin: { description: 'Пусто — схема площадки.' },
        },
      ],
    },
    {
      name: 'pricing',
      type: 'json',
      label: 'Цены по схеме зала',
      validate: (value: unknown, { siblingData }: { siblingData?: { planId?: string | null } }) =>
        validateSeatPricing(value, siblingData?.planId),
      admin: {
        components: {
          Field: {
            path: '/payload/components/seating/SeatPricingField#SeatPricingField',
            clientProps: { planPath: 'planId', venuePath: 'venue' },
          },
        },
      },
    },
  ],
}
