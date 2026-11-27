import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { Shows } from '../../src/payload/collections/Shows'
import { withTabNav } from '../../src/payload/fields'

type NavProps = { index: number; prevLabel?: string; nextLabel?: string }

const navOf = (fields: Field[]): NavProps => {
  const last = fields.at(-1) as Field & {
    admin: { components: { Field: { path: string; clientProps: NavProps } } }
  }
  expect(last.type).toBe('ui')
  expect(last.admin.components.Field.path).toBe('/payload/components/TabNav#TabNav')
  return last.admin.components.Field.clientProps
}

describe('withTabNav', () => {
  const tabs = withTabNav([
    { label: 'Первая', fields: [] as Field[] },
    { label: 'Вторая', fields: [] as Field[] },
    { label: 'Третья', fields: [] as Field[] },
  ])

  it('appends Back/Next with neighbour labels; none past the ends', () => {
    expect(navOf(tabs[0]!.fields)).toEqual({ index: 0, nextLabel: 'Вторая' })
    expect(navOf(tabs[1]!.fields)).toEqual({ index: 1, prevLabel: 'Первая', nextLabel: 'Третья' })
    expect(navOf(tabs[2]!.fields)).toEqual({ index: 2, prevLabel: 'Вторая' })
  })

  it('gives every nav field a unique name (ui fields, no DB columns)', () => {
    const names = tabs.map((t) => (t.fields.at(-1) as { name: string }).name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('is wired into the show form: Основное → … → SEO', () => {
    const tabsField = Shows.fields.find((f) => f.type === 'tabs') as {
      tabs: { label: string; fields: Field[] }[]
    }
    expect(tabsField.tabs.map((t) => t.label)).toEqual([
      'Основное',
      'Описание и состав',
      'Медиа',
      'SEO',
    ])
    expect(navOf(tabsField.tabs[0]!.fields)).toEqual({ index: 0, nextLabel: 'Описание и состав' })
    // Даты, площадки и билеты — в «Показах», не в спектакле.
    expect(navOf(tabsField.tabs[3]!.fields)).toEqual({ index: 3, prevLabel: 'Медиа' })
  })
})
