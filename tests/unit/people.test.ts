import { describe, expect, it } from 'vitest'

import { getPersonPage, getPersonProfile, listPeople, personSlug } from '../../src/modules/people'
import type { ShowsData } from '../../src/modules/shows'

const data: ShowsData = {
  venues: [{ id: 'v', title: 'Зал', address: 'ул. 1', kind: 'stage' }],
  shows: [
    {
      slug: 'women',
      title: '8 любящих женщин',
      genre: 'Комедийный детектив',
      ageLimit: null,
      durationMinutes: null,
      lead: '',
      description: [],
      gallery: [
        'https://example.test/w1.jpg',
        'https://example.test/w2.jpg',
        'https://example.test/w3.jpg',
      ],
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
      gallery: ['https://example.test/f1.jpg'],
      eventType: 'spectacle',
      credits: [
        { role: 'Режиссер, продюсер', entries: [{ people: ['Ирина Павлова'] }] },
        { role: 'Хореограф', entries: [{ people: ['Ирина Павлова'] }] },
        { role: 'В ролях', entries: [{ character: 'Анфиса', people: ['Юлия Штенцель'] }] },
      ],
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
    {
      id: 'w-0',
      showSlug: 'women',
      venueId: 'v',
      startsAt: '2026-10-01T19:00:00+05:00',
      ticketTypes: [],
    },
    {
      id: 'w-2',
      showSlug: 'women',
      venueId: 'v',
      startsAt: '2026-11-20T19:00:00+05:00',
      ticketTypes: [],
    },
  ],
}

data.archive = [
  {
    slug: 'onegin',
    title: 'Другой Онегин',
    genre: 'Иммерсивный спектакль',
    posterUrl: 'https://example.test/o.jpg',
    credits: [
      { role: 'Режиссёры', entries: [{ people: ['Ирина Павлова'] }] },
      {
        role: 'В ролях',
        entries: [
          { character: 'Татьяна', people: ['Юлия Штенцель'] },
          { character: 'Пушкин', people: ['Никита Бондаренко'] },
        ],
      },
    ],
  },
]

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
  it('collects unique people from published and archived shows, sorted by name', () => {
    expect(listPeople(data).map((p) => p.name)).toEqual([
      'Ирина Павлова',
      'Кристина Русанова',
      'Надежда Ускова',
      'Никита Бондаренко',
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
        role: 'Режиссер, продюсер',
        character: null,
        nextStartsAt: null,
      },
      {
        show: { slug: 'flight', title: 'Полёт нормальный' },
        role: 'Хореограф',
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

describe('getPersonProfile', () => {
  it('derives fields of work from credit roles, without duplicates', () => {
    expect(getPersonProfile(data, 'irina-pavlova', now)?.fields).toEqual([
      'Режиссура',
      'Продюсирование',
      'Хореография',
    ])
    expect(getPersonProfile(data, 'yuliya-shtentsel', now)?.fields).toEqual(['Актёрские работы'])
  })

  it('groups roles by show with cover, genre and the next performance', () => {
    const profile = getPersonProfile(data, 'yuliya-shtentsel', now)
    expect(profile?.shows).toEqual([
      {
        slug: 'women',
        title: '8 любящих женщин',
        genre: 'Комедийный детектив',
        posterUrl: 'https://example.test/p.jpg',
        photoUrl: 'https://example.test/w1.jpg',
        roles: [{ kind: 'character', title: 'Сюзон' }],
        next: { id: 'w-1', startsAt: '2026-10-20T19:00:00+05:00', venueTitle: 'Зал' },
      },
      {
        slug: 'flight',
        title: 'Полёт нормальный',
        genre: null,
        posterUrl: 'https://example.test/f.jpg',
        photoUrl: 'https://example.test/f1.jpg',
        roles: [{ kind: 'character', title: 'Анфиса' }],
        next: null,
      },
    ])
  })

  it('names the credit when there is no character', () => {
    expect(getPersonProfile(data, 'irina-pavlova', now)?.shows[1]?.roles).toEqual([
      { kind: 'credit', title: 'Режиссер, продюсер' },
      { kind: 'credit', title: 'Хореограф' },
    ])
  })

  it('calls a cast line without a character «В составе»', () => {
    const cast: ShowsData = {
      ...data,
      archive: [],
      shows: [
        { ...data.shows[0]!, credits: [{ role: 'В ролях', entries: [{ people: ['Ян Ли'] }] }] },
      ],
    }
    expect(getPersonProfile(cast, 'yan-li', now)?.shows[0]?.roles).toEqual([
      { kind: 'credit', title: 'В составе' },
    ])
  })

  it('puts past productions into the archive, without performances', () => {
    expect(getPersonProfile(data, 'yuliya-shtentsel', now)?.archive).toEqual([
      {
        slug: 'onegin',
        title: 'Другой Онегин',
        genre: 'Иммерсивный спектакль',
        posterUrl: 'https://example.test/o.jpg',
        roles: [{ kind: 'character', title: 'Татьяна' }],
      },
    ])
  })

  it('opens a page for a person known only from the archive', () => {
    const profile = getPersonProfile(data, 'nikita-bondarenko', now)
    expect(profile?.shows).toEqual([])
    expect(profile?.archive.map((a) => a.title)).toEqual(['Другой Онегин'])
    expect(profile?.fields).toEqual(['Актёрские работы'])
  })

  it('counts shows, roles and upcoming performances', () => {
    expect(getPersonProfile(data, 'yuliya-shtentsel', now)?.stats).toEqual({
      shows: 2,
      roles: 2,
      upcoming: 2,
    })
  })

  it('mixes photos of the shows in turn, each labelled with its show', () => {
    expect(getPersonProfile(data, 'yuliya-shtentsel', now)?.gallery).toEqual([
      { src: 'https://example.test/w1.jpg', showSlug: 'women', showTitle: '8 любящих женщин' },
      { src: 'https://example.test/f1.jpg', showSlug: 'flight', showTitle: 'Полёт нормальный' },
      { src: 'https://example.test/w2.jpg', showSlug: 'women', showTitle: '8 любящих женщин' },
      { src: 'https://example.test/w3.jpg', showSlug: 'women', showTitle: '8 любящих женщин' },
    ])
  })

  it('returns null for unknown people', () => {
    expect(getPersonProfile(data, 'nobody', now)).toBeNull()
  })
})
