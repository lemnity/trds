'use client'

import { Button, Checkbox, FieldError, Input, Label, TextField } from '@heroui/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'

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
import { normalizeReferralCode } from '@/modules/loyalty'

import { InlineNotice } from '../ui/InlineNotice'
import { postJson, returnPath } from './api'
import { PasswordField } from './PasswordField'
import {
  IS_STATIC_PREVIEW,
  setSignedIn,
  startDemoSession,
  useSession,
  type Session,
} from './session'
import styles from './Auth.module.css'

type Mode = 'login' | 'register'
type Step = 'details' | 'code' | 'checked'

/** Через сколько секунд можно запросить код ещё раз. */
const RESEND_AFTER = 60

// Код друга из ссылки `/register?ref=` (T-062): читается в браузере, на сервере — нет.
const noSubscribe = () => () => {}
const readInvite = () =>
  normalizeReferralCode(new URLSearchParams(window.location.search).get('ref'))

/**
 * Вход и регистрация (PRD 5.5): почта (и имя с согласием при регистрации) → код из письма;
 * при входе — запасной способ «по паролю». На сервере — настоящие запросы к /api/auth/* (T-050, T-055);
 * на статическом превью без сервера — демо-вход в браузере с честной пометкой.
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
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const router = useRouter()
  const codeRef = useRef<HTMLInputElement>(null)
  // Код приглашения живёт в состоянии формы и переживает шаг с кодом из письма. Уже вошедший
  // зритель по ссылке друга ничего не привязывает: приглашение — только для новых.
  const session = useSession()
  const urlInvite = useSyncExternalStore(noSubscribe, readInvite, () => null)
  const invite = mode === 'register' && !session ? urlInvite : null

  // Обратный отсчёт до повторной отправки.
  useEffect(() => {
    if (left <= 0) return
    const id = window.setTimeout(() => setLeft(left - 1), 1000)
    return () => window.clearTimeout(id)
  }, [left])

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  // Превью без сервера (GitHub Pages) — демо-вход в этом браузере, чтобы посмотреть меню.
  const demoSignIn = () => {
    startDemoSession({ name: name.trim() || email.split('@')[0] || 'Зритель', email })
    setStep('checked')
  }

  // Сервер: сессия уже в HttpOnly cookie — обновляем меню и уходим туда, откуда пришли.
  const finishSignIn = (customer: Session) => {
    setSignedIn(customer)
    router.push(returnPath())
  }

  const problem = (status: number, data: { error?: string; retryAfter?: number } | null) => {
    if (data?.error === 'email_unavailable')
      return 'Отправка писем пока не настроена — вход временно недоступен.'
    if (status === 503) return 'Вход временно недоступен: нет связи с сервером. Попробуйте позже.'
    if (data?.error === 'too_many')
      return `Слишком много попыток. Попробуйте через ${Math.ceil((data.retryAfter ?? 600) / 60)} мин.`
    if (status === 0) return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'
    return 'Что-то пошло не так. Попробуйте ещё раз.'
  }

  /** Запросить код у сервера. true — можно вводить код. */
  const requestCode = async (address: string) => {
    if (IS_STATIC_PREVIEW) return true
    setBusy(true)
    const { status, data } = await postJson<{ error?: string; retryAfter?: number }>(
      '/api/auth/email-code/request',
      mode === 'login'
        ? { purpose: 'login', email: address }
        : { purpose: 'register', email: address, name, password, consent },
    )
    setBusy(false)
    if (status === 200) {
      setLeft(RESEND_AFTER)
      return true
    }
    // Код уже отправлен недавно — пусть вводит его, повтор — по таймеру.
    if (data?.error === 'cooldown') {
      setLeft(data.retryAfter ?? RESEND_AFTER)
      return true
    }
    setNotice(problem(status, data))
    return false
  }

  const submitDetails = async (event: FormEvent) => {
    event.preventDefault()
    setNotice('')
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
    if (!(await requestCode(result.value.email))) return
    if (IS_STATIC_PREVIEW) setLeft(RESEND_AFTER)
    setStep('code')
  }

  const submitCode = async (event: FormEvent) => {
    event.preventDefault()
    if (!isCodeComplete(code)) {
      setCodeError(`Введите ${CODE_LENGTH} цифр из письма`)
      return
    }
    setCodeError('')
    if (IS_STATIC_PREVIEW) return demoSignIn()
    setBusy(true)
    const { status, data } = await postJson<{ customer?: Session; error?: string }>(
      '/api/auth/email-code/verify',
      { email, code, ...(invite && { ref: invite }) },
    )
    setBusy(false)
    if (status === 200 && data?.customer) return finishSignIn(data.customer)
    if (status === 400) {
      setCodeError('Неверный или устаревший код. Проверьте письмо или запросите новый.')
      return
    }
    setCodeError(problem(status, data))
  }

  const resend = async () => {
    setCodeError('')
    setCode('')
    if (IS_STATIC_PREVIEW) return setLeft(RESEND_AFTER)
    await requestCode(email)
  }

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault()
    setNotice('')
    const result = parsePasswordLogin({ email, password })
    if (!result.ok) {
      setErrors({ email: result.errors.email })
      setPasswordError(result.errors.password ?? '')
      return
    }
    setErrors({})
    setPasswordError('')
    if (IS_STATIC_PREVIEW) return demoSignIn()
    setBusy(true)
    const { status, data } = await postJson<{ customer?: Session; error?: string }>(
      '/api/auth/password',
      result.value,
    )
    setBusy(false)
    if (status === 200 && data?.customer) return finishSignIn(data.customer)
    if (status === 400) {
      setPasswordError('Неверная почта или пароль')
      return
    }
    setNotice(problem(status, data))
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
        {notice && (
          <p className={styles.error} role="alert">
            {notice}
          </p>
        )}
        <Button type="submit" fullWidth className={styles.submit} isPending={busy}>
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
        {invite && (
          <InlineNotice tone="info" title="Вас пригласил друг">
            Зарегистрируйтесь по этой ссылке — когда купите первый билет, другу засчитается
            приглашение.
          </InlineNotice>
        )}
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
        {notice && (
          <p className={styles.error} role="alert">
            {notice}
          </p>
        )}
        <Button type="submit" fullWidth className={styles.submit} isPending={busy}>
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
        <Button type="submit" fullWidth className={styles.submit} isPending={busy}>
          {mode === 'login' ? 'Войти' : 'Подтвердить и войти'}
        </Button>
        {process.env.NODE_ENV === 'development' && !IS_STATIC_PREVIEW && (
          // Почтовый сервис не подключён (T-047): в разработке письма — в локальном ящике.
          <p className={styles.hint}>
            Разработка: письмо с кодом —{' '}
            <a href="/api/dev/outbox" target="_blank" rel="noopener">
              локальный ящик
            </a>
          </p>
        )}
        <div className={styles.codeActions}>
          <button type="button" className={styles.linkButton} onClick={() => setStep('details')}>
            Изменить почту
          </button>
          {left > 0 ? (
            <span className={styles.muted}>Отправить ещё раз через {left} с</span>
          ) : (
            <button type="button" className={styles.linkButton} onClick={resend} disabled={busy}>
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
