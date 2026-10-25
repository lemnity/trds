import { ValidationError, type CollectionBeforeValidateHook, type CollectionConfig } from 'payload'

import { fieldNobody, salesAccess } from '../access/roles'
import { SLUG_PATTERN } from '../fields'
import {
  PERFORMANCES_SLUG,
  TICKET_TYPES_SLUG,
  guardTicketTypeDelete,
  syncTicketTypeCapacity,
} from '../hooks/inventorySync'

const isCount = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** Ключ категории уникален в пределах показа (в inventory ключ — показ + категория). */
const uniqueCodePerPerformance: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const performance = data?.performance ?? originalDoc?.performance
  const code = data?.code ?? originalDoc?.code
  if (!performance || !code) return data
  const { docs } = await req.payload.find({
    collection: TICKET_TYPES_SLUG,
    where: {
      and: [
        { performance: { equals: typeof performance === 'object' ? performance.id : performance } },
        { code: { equals: code } },
        ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
      ],
    },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  if (docs.length)
    throw new ValidationError({
      collection: TICKET_TYPES_SLUG,
      errors: [{ path: 'code', message: 'У этого показа уже есть категория с таким ключом' }],
      req,
    })
  return data
}

/**
 * Категории билетов (T-021): цена и квота. Правит только администратор театра (кассир и
 * редактор — нет). Остаток не хранится здесь: после сохранения квота уходит в inventory через
 * syncCapacity, а отказ «ниже проданного» возвращается ошибкой поля «Вместимость».
 */
export const TicketTypes: CollectionConfig = {
  slug: TICKET_TYPES_SLUG,
  labels: { singular: 'Категория билетов', plural: 'Категории билетов' },
  admin: {
    group: 'Продажи',
    useAsTitle: 'title',
    defaultColumns: ['title', 'performance', 'priceKopecks', 'capacity'],
    description:
      'Цены в копейках. Вместимость нельзя поставить ниже уже проданного и забронированного.',
  },
  access: salesAccess,
  defaultSort: 'sortOrder',
  hooks: {
    beforeValidate: [uniqueCodePerPerformance],
    afterChange: [syncTicketTypeCapacity()],
    beforeDelete: [guardTicketTypeDelete()],
  },
  fields: [
    {
      name: 'performance',
      type: 'relationship',
      relationTo: PERFORMANCES_SLUG,
      label: 'Показ',
      required: true,
      index: true,
      access: { update: fieldNobody },
    },
    {
      name: 'code',
      type: 'text',
      label: 'Ключ',
      required: true,
      defaultValue: 'standard',
      validate: (v: string | null | undefined) =>
        (!!v && SLUG_PATTERN.test(v)) || 'Латиница, цифры и дефис: «standard», «vip»',
      access: { update: fieldNobody },
      admin: { description: 'Не меняется после создания: на него ссылаются заказы.' },
    },
    { name: 'title', type: 'text', label: 'Название', required: true },
    {
      type: 'row',
      fields: [
        {
          name: 'priceKopecks',
          type: 'number',
          label: 'Цена, коп.',
          required: true,
          min: 0,
          validate: (v: number | null | undefined) => isCount(v) || 'Целое число копеек',
          admin: { description: '1 000 ₽ = 100000' },
        },
        {
          name: 'capacity',
          type: 'number',
          label: 'Вместимость (квота)',
          required: true,
          min: 0,
          validate: (v: number | null | undefined) => isCount(v) || 'Целое число билетов',
          admin: { description: 'Не ниже проданного и забронированного.' },
        },
      ],
    },
    {
      name: 'placeholder',
      type: 'checkbox',
      label: 'Цена не утверждена театром (на сайте — «предварительно»)',
    },
    { name: 'sortOrder', type: 'number', label: 'Порядок', defaultValue: 0 },
  ],
}
