import { describe, expect, it } from 'vitest'

import {
  CODE_LENGTH,
  isCodeComplete,
  maskEmail,
  normalizeCode,
  parseLogin,
  parsePasswordLogin,
  parseRegistration,
} from '../../src/modules/auth'

describe('parseLogin', () => {
  it('normalizes the email', () => {
    expect(parseLogin({ email: '  Stepan@Theatre.RU ' })).toEqual({
      ok: true,
      value: { email: 'stepan@theatre.ru' },
    })
  })

  it('rejects an invalid email with a readable message', () => {
    expect(parseLogin({ email: 'stepan@' })).toEqual({
      ok: false,
      errors: { email: 'Проверьте адрес электронной почты' },
    })
  })
})

describe('parseRegistration', () => {
  it('accepts name, email, password and consent', () => {
    expect(
      parseRegistration({
        name: ' Степан Верховенский ',
        email: 'S@t.ru',
        password: 'теат р 12',
        consent: true,
      }),
    ).toEqual({
      ok: true,
      value: { name: 'Степан Верховенский', email: 's@t.ru', password: 'теат р 12' },
    })
  })

  it('requires a name, a valid email, a long enough password and personal data consent', () => {
    expect(
      parseRegistration({ name: ' ', email: 'x', password: '1234567', consent: false }),
    ).toEqual({
      ok: false,
      errors: {
        name: 'Укажите имя',
        email: 'Проверьте адрес электронной почты',
        password: 'Пароль — не короче 8 символов',
        consent: 'Нужно согласие на обработку персональных данных',
      },
    })
  })
})

describe('code input', () => {
  it('keeps only digits up to the code length', () => {
    expect(normalizeCode('12 3-4a5678')).toBe('123456')
    expect(CODE_LENGTH).toBe(6)
  })

  it('tells when the code is complete', () => {
    expect(isCodeComplete('12345')).toBe(false)
    expect(isCodeComplete('123456')).toBe(true)
  })
})

describe('maskEmail', () => {
  it('hides the middle of the local part', () => {
    expect(maskEmail('stepan@theatre.ru')).toBe('s••••n@theatre.ru')
    expect(maskEmail('ab@t.ru')).toBe('a•@t.ru')
  })
})

describe('parsePasswordLogin', () => {
  it('accepts email and password, keeping the password as typed', () => {
    expect(parsePasswordLogin({ email: ' A@B.ru ', password: ' secret ' })).toEqual({
      ok: true,
      value: { email: 'a@b.ru', password: ' secret ' },
    })
  })

  it('requires a valid email and a password', () => {
    expect(parsePasswordLogin({ email: 'a@', password: '' })).toEqual({
      ok: false,
      errors: { email: 'Проверьте адрес электронной почты', password: 'Введите пароль' },
    })
  })
})
