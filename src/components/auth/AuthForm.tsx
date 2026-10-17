'use client'

import { Button, Checkbox, Description, FieldError, Input, Label, TextField } from '@heroui/react'
import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import {
  CODE_LENGTH,
  PASSWORD_MIN,
  isCodeComplete,
  maskEmail,
  normalizeCode,
  parseLogin,
  parsePasswordLogin,
  parseRegistration,
  type RegistrationErrors,
} from '@/modules/auth'

import { InlineNotice } from '../ui/InlineNotice'
import { startDemoSession } from './session'
import styles from './Auth.module.css'

type Mode = 'login' | 'register'
type Step = 'details' | 'code' | 'checked'

/** Через сколько секунд можно запросить код ещё раз. */
const RESEND_AFTER = 60

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
function PasswordField({
  value,
  onChange,
  error,
  autoComplete,
  description,
}: {
  value: string
  onChange: (value: string) => void
  error?: string
  autoComplete: 'current-password' | 'new-password'
  description?: string
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
      validationBehavior="aria"
    >
      <Label>Пароль</Label>
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

/**
 * Вход и регистрация (PRD 5.5): почта (и имя с согласием при регистрации) → код из письма;
 * при входе — запасной способ «по паролю». ПРОТОТИП: сервера выдачи и проверки кода ещё нет (T-050) — код не
 * отправляется, данные никуда не уходят; это сказано пользователю на странице.
 */
export function AuthForm({ mode }: { mode: Mode }) {
  const [step, setStep] = useState<Step>('details')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<RegistrationErrors>({})
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [left, setLeft] = useState(0)
  // Вход: по коду (основной) или по паролю (запасной, решение заказчика 18.10.2026).
  const [method, setMethod] = useState<'code' | 'password'>('code')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const codeRef = useRef<HTMLInputElement>(null)

  // Обратный отсчёт до повторной отправки.
  useEffect(() => {
    if (left <= 0) return
    const id = window.setTimeout(() => setLeft(left - 1), 1000)
    return () => window.clearTimeout(id)
  }, [left])

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  // ДЕМО до T-050: «вход» только в этом браузере, чтобы посмотреть меню кабинета.
  const signIn = () => {
    startDemoSession({ name: name.trim() || email.split('@')[0] || 'Зритель', email })
    setStep('checked')
  }

  const submitDetails = (event: FormEvent) => {
    event.preventDefault()
    const result =
      mode === 'login'
        ? parseLogin({ email })
        : parseRegistration({ name, email, password, consent })
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setEmail(result.value.email)
    setCode('')
    setCodeError('')
    setLeft(RESEND_AFTER)
    setStep('code')
  }

  const submitCode = (event: FormEvent) => {
    event.preventDefault()
    if (!isCodeComplete(code)) {
      setCodeError(`Введите ${CODE_LENGTH} цифр из письма`)
      return
    }
    setCodeError('')
    signIn()
  }

  const submitPassword = (event: FormEvent) => {
    event.preventDefault()
    const result = parsePasswordLogin({ email, password })
    if (!result.ok) {
      setErrors({ email: result.errors.email })
      setPasswordError(result.errors.password ?? '')
      return
    }
    setErrors({})
    setPasswordError('')
    signIn()
  }

  const switchMethod = (next: 'code' | 'password') => {
    setMethod(next)
    setErrors({})
    setPasswordError('')
  }

  if (step === 'details' && mode === 'login' && method === 'password')
    return (
      <form className={styles.form} onSubmit={submitPassword} noValidate>
        <TextField
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(v) => {
            setEmail(v)
            setErrors((e) => ({ ...e, email: undefined }))
          }}
          isRequired
          isInvalid={Boolean(errors.email)}
          validationBehavior="aria"
        >
          <Label>E-mail</Label>
          <Input placeholder="you@theatre.ru" />
          <FieldError>{errors.email}</FieldError>
        </TextField>
        <PasswordField
          value={password}
          onChange={(v) => {
            setPassword(v)
            setPasswordError('')
          }}
          error={passwordError}
          autoComplete="current-password"
        />
        <Button type="submit" fullWidth className={styles.submit}>
          Войти
        </Button>
        <p className={styles.alt}>
          Забыли пароль?{' '}
          <button type="button" className={styles.linkButton} onClick={() => switchMethod('code')}>
            Войти по коду из письма
          </button>
        </p>
      </form>
    )

  if (step === 'details')
    return (
      <form className={styles.form} onSubmit={submitDetails} noValidate>
        {mode === 'register' && (
          <TextField
            autoComplete="name"
            value={name}
            onChange={(v) => {
              setName(v)
              setErrors((e) => ({ ...e, name: undefined }))
            }}
            isRequired
            isInvalid={Boolean(errors.name)}
            validationBehavior="aria"
          >
            <Label>Имя</Label>
            <Input placeholder="Степан Верховенский" />
            <FieldError>{errors.name}</FieldError>
          </TextField>
        )}
        <TextField
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(v) => {
            setEmail(v)
            setErrors((e) => ({ ...e, email: undefined }))
          }}
          isRequired
          isInvalid={Boolean(errors.email)}
          validationBehavior="aria"
        >
          <Label>E-mail</Label>
          <Input placeholder="you@theatre.ru" />
          <FieldError>{errors.email}</FieldError>
        </TextField>
        {mode === 'register' && (
          <PasswordField
            value={password}
            onChange={(v) => {
              setPassword(v)
              setErrors((e) => ({ ...e, password: undefined }))
            }}
            error={errors.password}
            autoComplete="new-password"
            description={`Не короче ${PASSWORD_MIN} символов`}
          />
        )}
        {mode === 'register' && (
          <Checkbox
            isSelected={consent}
            onChange={(v) => {
              setConsent(v)
              setErrors((e) => ({ ...e, consent: undefined }))
            }}
            isRequired
            isInvalid={Boolean(errors.consent)}
            validationBehavior="aria"
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>Согласен на обработку персональных данных</Label>
            </Checkbox.Content>
            <FieldError>{errors.consent}</FieldError>
          </Checkbox>
        )}
        {mode === 'register' && (
          // Ссылка вне подписи галочки (иначе нажатие переключает галочку) и в новой вкладке —
          // переход со страницы сбросил бы форму.
          <p className={styles.hint}>
            <Link href="/documents/personal-data" target="_blank" rel="noopener">
              Как мы обрабатываем персональные данные
            </Link>
          </p>
        )}
        <Button type="submit" fullWidth className={styles.submit}>
          Получить код
        </Button>
        <p className={styles.hint}>
          {mode === 'register'
            ? `Подтвердим почту кодом из ${CODE_LENGTH} цифр — пришлём его в письме.`
            : `Пришлём на почту одноразовый код из ${CODE_LENGTH} цифр.`}
        </p>
        {mode === 'login' && (
          <p className={styles.alt}>
            <span className={styles.or}>или</span>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => switchMethod('password')}
            >
              Войти по паролю
            </button>
          </p>
        )}
      </form>
    )

  if (step === 'code')
    return (
      <form className={styles.form} onSubmit={submitCode} noValidate>
        <p className={styles.sent}>
          Код отправлен на <b>{maskEmail(email)}</b>
        </p>
        <div className={styles.codeField}>
          <label htmlFor="otp" className={styles.codeLabel}>
            Код из письма
          </label>
          {/* Одно поле (вставка и автозаполнение кода работают), клетки — его отрисовка. */}
          <div className={styles.cells} data-invalid={codeError ? '' : undefined}>
            <input
              ref={codeRef}
              id="otp"
              className={styles.codeInput}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(e) => {
                setCode(normalizeCode(e.target.value))
                setCodeError('')
              }}
              aria-invalid={codeError ? true : undefined}
              aria-describedby={codeError ? 'otp-error' : undefined}
            />
            {Array.from({ length: CODE_LENGTH }, (_, i) => (
              <span
                key={i}
                className={styles.cell}
                data-filled={code[i] ? '' : undefined}
                data-active={i === Math.min(code.length, CODE_LENGTH - 1) ? '' : undefined}
                aria-hidden="true"
              >
                {code[i] ?? ''}
              </span>
            ))}
          </div>
          {codeError && (
            <p id="otp-error" className={styles.error}>
              {codeError}
            </p>
          )}
        </div>
        <Button type="submit" fullWidth className={styles.submit}>
          {mode === 'login' ? 'Войти' : 'Подтвердить и войти'}
        </Button>
        <div className={styles.codeActions}>
          <button type="button" className={styles.linkButton} onClick={() => setStep('details')}>
            Изменить почту
          </button>
          {left > 0 ? (
            <span className={styles.muted}>Отправить ещё раз через {left} с</span>
          ) : (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setLeft(RESEND_AFTER)}
            >
              Отправить код ещё раз
            </button>
          )}
        </div>
      </form>
    )

  return (
    <div className={styles.form} role="status">
      <InlineNotice tone="info" title="Это прототип формы">
        {method === 'password' && mode === 'login'
          ? 'Пароль не проверялся'
          : 'Код не отправлялся и не проверялся'}
        . Включён демо-вход в этом браузере — откройте меню «Личный кабинет», чтобы посмотреть
        разделы; «Выйти из аккаунта» его снимет. Настоящий вход заработает вместе с продажей билетов
        на сайте.
      </InlineNotice>
      <button
        type="button"
        className={styles.linkButton}
        onClick={() => {
          setPassword('')
          setStep('details')
        }}
      >
        Начать сначала
      </button>
      <Link href="/" className={styles.linkButton}>
        На главную
      </Link>
    </div>
  )
}
