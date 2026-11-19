'use client'

import { useFormFields } from '@payloadcms/ui'

import { categoriesHint } from './hintText'

/** Описание блока категорий: зависит от схемы зала, выбранной в показе. */
export function CategoriesHint() {
  const planId = useFormFields(([fields]) => fields['seating.planId']?.value)
  return (
    <p style={{ margin: '0 0 var(--base)', color: 'var(--theme-elevation-500)' }}>
      {categoriesHint(typeof planId === 'string' ? planId : null)}
    </p>
  )
}
