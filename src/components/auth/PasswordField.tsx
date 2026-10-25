'use client'

import { Description, FieldError, Input, Label, TextField } from '@heroui/react'
import { useState } from 'react'

import styles from './Auth.module.css'

const EyeIcon = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path
      d={
        open
          ? 'M3 3l18 18M10.6 6.2A9.6 9.6 0 0 1 12 6c5 0 8.5 4.5 9.5 6-.5.8-1.6 2.3-3.2 3.6M6.3 7.8C4.6 9 3.4 10.7 2.5 12c1 1.5 4.5 6 9.5 6 1.5 0 2.9-.4 4.1-1M9.9 9.9a3 3 0 0 0 4.2 4.2'
          : 'M2.5 12C3.5 10.5 7 6 12 6s8.5 4.5 9.5 6c-1 1.5-4.5 6-9.5 6s-8.5-4.5-9.5-6ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'
      }
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** Поле пароля с кнопкой «показать / скрыть» внутри. */
export function PasswordField({
  value,
  onChange,
  error,
  autoComplete,
  description,
  label = 'Пароль',
  isDisabled,
}: {
  value: string
  onChange: (value: string) => void
  error?: string
  autoComplete: 'current-password' | 'new-password'
  description?: string
  label?: string
  isDisabled?: boolean
}) {
  const [shown, setShown] = useState(false)
  return (
    <TextField
      type={shown ? 'text' : 'password'}
      autoComplete={autoComplete}
      value={value}
      onChange={onChange}
      isRequired
      isInvalid={Boolean(error)}
      isDisabled={isDisabled}
      validationBehavior="aria"
    >
      <Label>{label}</Label>
      <div className={styles.passwordRow}>
        <Input />
        <button
          type="button"
          className={styles.reveal}
          aria-pressed={shown}
          aria-label={shown ? 'Скрыть пароль' : 'Показать пароль'}
          onClick={() => setShown(!shown)}
        >
          <EyeIcon open={shown} />
        </button>
      </div>
      {description && !error && <Description>{description}</Description>}
      <FieldError>{error}</FieldError>
    </TextField>
  )
}
