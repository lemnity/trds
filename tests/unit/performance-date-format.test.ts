import { describe, expect, it } from 'vitest'

import { RU_DATE_TIME } from '@/payload/collections/Performances'

describe('формат даты показа в админке', () => {
  it('русский порядок и 24-часовое время (ввод разбирается тем же displayFormat)', () => {
    expect(RU_DATE_TIME.displayFormat).toBe('dd.MM.yyyy HH:mm')
    expect(RU_DATE_TIME.timeFormat).toBe('HH:mm')
    expect(RU_DATE_TIME.timeIntervals).toBe(15)
  })
})
