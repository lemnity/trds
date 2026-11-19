import { describe, expect, it } from 'vitest'

import { RU_DATE_ONLY, RU_DATE_TIME } from '@/payload/fields'

describe('формат даты показа в админке', () => {
  it('русский порядок и 24-часовое время (ввод разбирается тем же displayFormat)', () => {
    expect(RU_DATE_TIME.displayFormat).toBe('dd.MM.yyyy HH:mm')
    expect(RU_DATE_TIME.timeFormat).toBe('HH:mm')
    expect(RU_DATE_TIME.timeIntervals).toBe(15)
  })

  it('поля только с датой показываются как дд.мм.гггг', () => {
    expect(RU_DATE_ONLY.displayFormat).toBe('dd.MM.yyyy')
    expect(RU_DATE_ONLY.pickerAppearance).toBe('dayOnly')
  })
})
