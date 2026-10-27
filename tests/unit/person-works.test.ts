import { describe, expect, it } from 'vitest'

import type { Archive, Person, Show } from '../../src/payload-types'
import { bioFromCms } from '../../src/modules/content/cms'

const show = { id: 1, slug: 'tartuffe', title: 'Тартюф' } as Show
const archived = { id: 7, slug: 'fedra', title: 'Федра' } as Archive

const person = (works: Person['works']) =>
  ({ id: 1, name: 'Артём Аксёнов', bio: 'Выпускник ЕГТИ.', works }) as Person

describe('bioFromCms — работы человека', () => {
  it('спектакль из афиши — название из каталога, ссылка на страницу и герой', () => {
    const bio = bioFromCms(
      person([{ show: { relationTo: 'shows', value: show }, character: 'Оргон' }]),
    )
    expect(bio?.works).toEqual([{ title: 'Тартюф', href: '/shows/tartuffe', character: 'Оргон' }])
  })

  it('спектакль из архива — название без ссылки (страницы архивной постановки нет)', () => {
    const bio = bioFromCms(person([{ show: { relationTo: 'archive', value: archived } }]))
    expect(bio?.works).toEqual([{ title: 'Федра' }])
  })

  it('работа вне театра — название вручную', () => {
    const bio = bioFromCms(person([{ title: '«Женитьба», Н. Гоголь', character: 'Подколёсин' }]))
    expect(bio?.works).toEqual([{ title: '«Женитьба», Н. Гоголь', character: 'Подколёсин' }])
  })

  it('спектакль не опубликован (связь не раскрыта) — берётся ручное название, без него строка пропускается', () => {
    const bio = bioFromCms(
      person([
        { show: { relationTo: 'shows', value: 5 }, title: 'Черновик' },
        { show: { relationTo: 'shows', value: 6 } },
      ]),
    )
    expect(bio?.works).toEqual([{ title: 'Черновик' }])
  })

  it('пустой герой не попадает в результат', () => {
    const bio = bioFromCms(
      person([{ show: { relationTo: 'shows', value: show }, character: '  ' }]),
    )
    expect(bio?.works).toEqual([{ title: 'Тартюф', href: '/shows/tartuffe' }])
  })
})
