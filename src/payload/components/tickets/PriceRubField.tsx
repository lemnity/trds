'use client'

import { FieldError, FieldLabel, useField } from '@payloadcms/ui'
import type { NumberFieldClientProps } from 'payload'
import { useState } from 'react'

import { parseRub, rubInput } from '@/lib/money'

import styles from './priceRub.module.css'

/**
 * Поле цены в рублях над числом копеек (`priceKopecks`): вводят «1500» или «1 500,50», в базе —
 * целые копейки. Пустой ввод — ошибка обязательного поля, мусор — своя подсказка.
 */
export function PriceRubField({ path, field, readOnly }: NumberFieldClientProps) {
  const { value, setValue, showError, errorMessage } = useField<number | null>({ path })
  // Пока поле в фокусе — показываем ввод как есть («1 500,»), иначе — сохранённую цену.
  const [editing, setEditing] = useState<string | null>(null)
  const draft = editing ?? rubInput(typeof value === 'number' ? value : null)
  const garbage = editing !== null && parseRub(editing) === undefined

  return (
    <div className={`field-type number ${styles.root}`}>
      <FieldLabel label={field.label ?? 'Цена, ₽'} path={path} required={field.required} />
      <div className={styles.input} data-invalid={garbage || showError}>
        <input
          id={`field-${path.replace(/\./g, '__')}`}
          inputMode="decimal"
          placeholder="0"
          value={draft}
          disabled={readOnly}
          onChange={(e) => {
            setEditing(e.target.value)
            // Мусор → пусто: форма не сохранится, пока цена не исправлена.
            setValue(parseRub(e.target.value) ?? null)
          }}
          onBlur={() => setEditing(null)}
        />
        <span aria-hidden="true">₽</span>
      </div>
      {garbage ? (
        <div className={styles.error}>Сумма в рублях: «1500» или «1 500,50»</div>
      ) : (
        <FieldError path={path} showError={showError} message={errorMessage} />
      )}
    </div>
  )
}
