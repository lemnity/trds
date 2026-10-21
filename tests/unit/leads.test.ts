import { describe, expect, it } from 'vitest'

import { LEAD_FORMATS, leadMailBody, parseLead } from '../../src/modules/leads'

const today = new Date('2026-10-21T12:00:00+05:00')
const valid = {
  name: ' Тати Сенютина ',
  email: 'Tati@Stolnik.ru',
  phone: '',
  date: '2026-12-25',
  guests: '40',
  format: 'corporate',
  budget: '',
  comment: ' Новогодний вечер ',
  consent: true,
}

describe('parseLead', () => {
  it('normalizes a complete lead', () => {
    expect(parseLead(valid, today)).toEqual({
      ok: true,
      value: {
        name: 'Тати Сенютина',
        email: 'tati@stolnik.ru',
        date: '2026-12-25',
        guests: 40,
        format: 'corporate',
        comment: 'Новогодний вечер',
      },
    })
  })

  it('accepts a phone instead of an email', () => {
    const r = parseLead({ ...valid, email: '', phone: '8 (912) 345-67-89' }, today)
    expect(r.ok && r.value).toMatchObject({ phone: '+79123456789' })
    expect(r.ok && 'email' in r.value).toBe(false)
  })

  it('needs a name, a way to reply and consent', () => {
    expect(parseLead({ ...valid, name: ' ', email: '', phone: '', consent: false }, today)).toEqual(
      {
        ok: false,
        errors: {
          name: 'Укажите имя',
          email: 'Оставьте почту или телефон, чтобы мы ответили',
          consent: 'Нужно согласие на обработку персональных данных',
        },
      },
    )
  })

  it('rejects a past date and an impossible guest count', () => {
    expect(parseLead({ ...valid, date: '2026-10-01', guests: '0' }, today)).toEqual({
      ok: false,
      errors: { date: 'Дата уже прошла', guests: 'Число гостей — от 1 до 1000' },
    })
  })

  it('knows the formats', () => {
    expect(LEAD_FORMATS.map((f) => f.id)).toEqual([
      'corporate',
      'presentation',
      'birthday',
      'private',
      'other',
    ])
  })
})

describe('leadMailBody', () => {
  it('lists only the filled fields', () => {
    const r = parseLead(valid, today)
    if (!r.ok) throw new Error('invalid')
    expect(leadMailBody(r.value)).toBe(
      [
        'Имя: Тати Сенютина',
        'Почта: tati@stolnik.ru',
        'Формат: Корпоратив',
        'Дата: 25.12.2026',
        'Гостей: 40',
        'Комментарий: Новогодний вечер',
      ].join('\n'),
    )
  })
})
