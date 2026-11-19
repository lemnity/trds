import { describe, expect, it } from 'vitest'

import { categoriesHint } from '@/payload/components/tickets/hintText'
import { khlebozavodPlan, belinskogoPlan } from '@/modules/seating'

describe('categoriesHint', () => {
  it('no plan: categories only for sales without a hall scheme', () => {
    expect(categoriesHint(null)).toMatch(/Нужны, только если продажа без схемы зала/)
    expect(categoriesHint(undefined)).toBe(categoriesHint(''))
  })
  it('seat plan: same text, prices are set on the scheme', () => {
    expect(categoriesHint(belinskogoPlan.id)).toMatch(/цены задаются выше, на схеме/)
  })
  it('zone plan: zones are sold as categories automatically', () => {
    expect(categoriesHint(khlebozavodPlan.id)).toBe(
      'Зоны схемы продаются как категории автоматически.',
    )
  })
})
