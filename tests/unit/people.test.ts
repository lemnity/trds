import { describe, expect, it } from 'vitest'

import { getPersonPage, listPeople, personSlug } from '../../src/modules/people'
import type { ShowsData } from '../../src/modules/shows'

const data: ShowsData = {
  venues: [{ id: 'v', title: 'Зал', address: 'ул. 1', kind: 'stage' }],
  shows: [
    {
      slug: 'women',
      title: '8 любящих женщин',
      genre: null,
      ageLimit: null,
      durationMinutes: null,
      lead: '',
      description: [],
      gallery: [],
      eventType: 'spectacle',
      credits: [
        { role: 'Режиссер', entries: [{ people: ['Ирина Павлова'] }] },
        {
          role: 'В ролях',
          entries: [
            { character: 'Габи', people: ['Надежда Ускова'] },
            { character: 'Сюзон', people: ['Кристина Русанова', 'Юлия Штенцель'] },
          ],
        },
      ],
      posterUrl: 'https://example.test/p.jpg',
      status: 'published',
    },
    {
      slug: 'flight',
      title: 'Полёт нормальный',
      genre: null,
      ageLimit: null,
      durationMinutes: null,
      lead: '',
      description: [],
      gallery: [],
      eventType: 'spectacle',
      credits: [{ role: 'Режиссер', entries: [{ people: ['Ирина Павлова'] }] }],
      posterUrl: 'https://example.test/f.jpg',
      status: 'published',
    },
    {
      slug: 'draft',
      title: 'Черновик',
      genre: null,
      ageLimit: null,
      durationMinutes: null,
      lead: '',
      description: [],
      gallery: [],
      eventType: 'spectacle',
      credits: [{ role: 'Режиссер', entries: [{ people: ['Скрытый Человек'] }] }],
      posterUrl: 'https://example.test/d.jpg',
      status: 'draft',
    },
  ],
  performances: [
    {
      id: 'w-1',
      showSlug: 'women',
      venueId: 'v',
      startsAt: '2026-10-20T19:00:00+05:00',
      ticketTypes: [],
    },
  ],
}

const now = new Date('2026-10-15T12:00:00+05:00')

describe('personSlug', () => {
  it('transliterates Russian names, treating ё as е', () => {
    expect(personSlug('Артём Аксёнов')).toBe('artem-aksenov')
    expect(personSlug('Артем Аксенов')).toBe('artem-aksenov')
    expect(personSlug('Юлия Штенцель')).toBe('yuliya-shtentsel')
    expect(personSlug('Яна Шайдетская')).toBe('yana-shaydetskaya')
  })
})

describe('listPeople', () => {
  it('collects unique people from published shows only, sorted by name', () => {
    expect(listPeople(data).map((p) => p.name)).toEqual([
      'Ирина Павлова',
      'Кристина Русанова',
      'Надежда Ускова',
      'Юлия Штенцель',
    ])
  })
})

describe('getPersonPage', () => {
  it('lists every role of the person with show links and the next performance', () => {
    const page = getPersonPage(data, 'irina-pavlova', now)
    expect(page?.person.name).toBe('Ирина Павлова')
    expect(page?.works).toEqual([
      {
        show: { slug: 'women', title: '8 любящих женщин' },
        role: 'Режиссер',
        character: null,
        nextStartsAt: '2026-10-20T19:00:00+05:00',
      },
      {
        show: { slug: 'flight', title: 'Полёт нормальный' },
        role: 'Режиссер',
        character: null,
        nextStartsAt: null,
      },
    ])
  })

  it('keeps the character for actors', () => {
    expect(getPersonPage(data, 'yuliya-shtentsel', now)?.works[0]).toMatchObject({
      role: 'В ролях',
      character: 'Сюзон',
    })
  })

  it('returns null for unknown people and people only in drafts', () => {
    expect(getPersonPage(data, 'nobody', now)).toBeNull()
    expect(getPersonPage(data, 'skrytyy-chelovek', now)).toBeNull()
  })
})
