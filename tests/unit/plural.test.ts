import { describe, expect, it } from 'vitest'

import { accountStatLabel } from '../../src/components/account/stats-view'
import { plural } from '../../src/lib/plural'
import { bonusWord } from '../../src/modules/checkout'
import { referralRemainingText } from '../../src/modules/loyalty'
import { plural as showsPlural } from '../../src/modules/shows'

// Один helper форм слова на весь сайт: «1 билет», «2 билета», «5 билетов», «11 билетов», «21 билет».
const word = (n: number) => plural(n, 'билет', 'билета', 'билетов')

describe('plural (Russian three forms)', () => {
  it('one / few / many, including the 11–14 exception and big numbers', () => {
    expect([0, 1, 2, 4, 5, 10, 11, 12, 14, 15, 20, 21, 22, 25].map(word)).toEqual([
      'билетов',
      'билет',
      'билета',
      'билета',
      'билетов',
      'билетов',
      'билетов',
      'билетов',
      'билетов',
      'билетов',
      'билетов',
      'билет',
      'билета',
      'билетов',
    ])
    expect([101, 111, 112, 122, 1001].map(word)).toEqual([
      'билет',
      'билетов',
      'билетов',
      'билета',
      'билет',
    ])
    // Отрицательные (сторно в истории) и дробные — по целой части модуля.
    expect(word(-1)).toBe('билет')
    expect(word(2.5)).toBe('билета')
  })

  it('is the same helper behind shows, checkout and loyalty texts', () => {
    expect(showsPlural).toBe(plural)
    expect([1, 3, 5, 21].map(bonusWord)).toEqual(['бонус', 'бонуса', 'бонусов', 'бонус'])
    expect(referralRemainingText(1)).toBe('Остался ещё 1 друг')
    expect(referralRemainingText(2)).toBe('Осталось ещё 2 друга')
    expect(referralRemainingText(5)).toBe('Осталось ещё 5 друзей')
  })
})

describe('account summary counters', () => {
  it('«1 билет впереди», «3 билета впереди», «5 билетов впереди»', () => {
    expect(accountStatLabel('upcoming', 1)).toBe('билет впереди')
    expect(accountStatLabel('upcoming', 3)).toBe('билета впереди')
    expect(accountStatLabel('upcoming', 5)).toBe('билетов впереди')
    expect(accountStatLabel('upcoming', 0)).toBe('билетов впереди')
    expect(accountStatLabel('visited', 1)).toBe('спектакль посещён')
    expect(accountStatLabel('visited', 22)).toBe('спектакля посещено')
    expect(accountStatLabel('visited', 11)).toBe('спектаклей посещено')
    expect(accountStatLabel('friends', 1)).toBe('друг приглашён')
    expect(accountStatLabel('friends', 2)).toBe('друга приглашено')
    expect(accountStatLabel('friends', 7)).toBe('друзей приглашено')
  })

  it('while loading (dash instead of a number) uses the neutral plural form', () => {
    expect(accountStatLabel('upcoming', null)).toBe('билетов впереди')
    expect(accountStatLabel('friends', null)).toBe('друзей приглашено')
  })
})
