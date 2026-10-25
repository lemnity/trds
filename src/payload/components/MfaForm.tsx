'use client'

import { Button } from '@payloadcms/ui'
import { useState, type FormEvent } from 'react'

import { MfaQr } from './MfaQr'

type Status = {
  required: boolean
  verified: boolean
  enrolled: boolean
  locked: boolean
  recoveryCodesLeft: number
}

const ERRORS: Record<string, string> = {
  INVALID_CODE: 'Код не подошёл: неверный, устаревший или уже использованный.',
  LOCKED: 'Слишком много неверных попыток. Подождите 15 минут.',
  ALREADY_ENROLLED: 'Второй фактор уже настроен.',
  NO_SETUP: 'Начните настройку заново.',
  NOT_ENROLLED: 'Второй фактор ещё не настроен.',
  mfa_required: 'Сначала подтвердите вход кодом.',
  forbidden: 'Действие недоступно.',
}

const groups = (s: string) => s.match(/.{1,4}/g)?.join(' ') ?? s

const field: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.6rem 0.75rem',
  fontSize: '1.25rem',
  letterSpacing: '0.2em',
  marginTop: '0.5rem',
}

/** Форма второго фактора. Все решения принимает сервер; здесь — ввод и понятные состояния. */
export function MfaForm({
  apiUrl,
  adminUrl,
  initial,
}: {
  apiUrl: string
  adminUrl: string
  initial: Status
}) {
  const [status, setStatus] = useState(initial)
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const post = async (path: string, body: unknown = {}) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${apiUrl}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setError(ERRORS[String(data.error)] ?? 'Не удалось выполнить. Попробуйте ещё раз.')
        return null
      }
      return data
    } catch {
      setError('Нет связи с сервером. Попробуйте ещё раз.')
      return null
    } finally {
      setBusy(false)
    }
  }

  // Полная перезагрузка: права админки пересчитываются на сервере с новой cookie.
  const enterAdmin = () => window.location.assign(adminUrl)

  const startSetup = async () => {
    const data = await post('/setup')
    if (data) setSetup(data as { secret: string; otpauthUrl: string })
  }

  const confirm = async (e: FormEvent) => {
    e.preventDefault()
    const data = await post('/setup/confirm', { code })
    if (!data) return
    setCodes(data.recoveryCodes as string[])
    setStatus((s) => ({ ...s, enrolled: true, verified: true, recoveryCodesLeft: 10 }))
  }

  const verify = async (e: FormEvent) => {
    e.preventDefault()
    const data = await post('/verify', useRecovery ? { recoveryCode: code } : { code })
    if (!data) return
    if (data.method === 'recovery')
      setStatus((s) => ({
        ...s,
        verified: true,
        recoveryCodesLeft: Number(data.recoveryCodesLeft),
      }))
    else enterAdmin()
  }

  const regenerate = async () => {
    const data = await post('/recovery-codes')
    if (data) setCodes(data.recoveryCodes as string[])
  }

  const reset = async () => {
    if (!window.confirm('Отключить второй фактор и настроить его заново на новом телефоне?')) return
    if (await post('/reset')) {
      setStatus((s) => ({ ...s, enrolled: false, verified: false, recoveryCodesLeft: 0 }))
      setSetup(null)
      setCode('')
    }
  }

  const codeInput = (
    <label style={{ display: 'block', margin: '1rem 0' }}>
      {useRecovery ? 'Код восстановления' : 'Код из приложения (6 цифр)'}
      <input
        style={field}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode={useRecovery ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        pattern={useRecovery ? '[A-Za-z2-7]{5}-?[A-Za-z2-7]{5}' : '\\d{6}'}
        required
        autoFocus
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'mfa-error' : undefined}
      />
    </label>
  )

  const errorBox = error && (
    <p id="mfa-error" role="alert" style={{ color: 'var(--theme-error-500)' }}>
      {error}
    </p>
  )

  if (codes)
    return (
      <section aria-labelledby="mfa-title">
        <h1 id="mfa-title">Коды восстановления</h1>
        <p>
          Сохраните их в надёжном месте (менеджер паролей или распечатка). Каждый код работает один
          раз — если телефон потерян. Больше они не покажутся.
        </p>
        <ol style={{ fontFamily: 'monospace', fontSize: '1.1rem', columns: 2 }}>
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
        <Button onClick={enterAdmin}>Я сохранил коды — в админку</Button>
      </section>
    )

  if (!status.enrolled)
    return (
      <section aria-labelledby="mfa-title">
        <h1 id="mfa-title">Второй фактор</h1>
        <p>
          {status.required
            ? 'Для администраторов вход по одному паролю закрыт. Настройте приложение-аутентификатор (Яндекс Ключ, Google Authenticator, 1Password).'
            : 'Можно включить вход с кодом из приложения-аутентификатора.'}
        </p>
        {!setup ? (
          <Button onClick={startSetup} disabled={busy}>
            Настроить
          </Button>
        ) : (
          <form onSubmit={confirm}>
            <p>1. Отсканируйте QR-код в приложении-аутентификаторе:</p>
            <MfaQr value={setup.otpauthUrl} />
            <p>
              Не сканируется — добавьте аккаунт вручную и введите ключ:
              <br />
              <code style={{ fontSize: '1.1rem', userSelect: 'all' }}>{groups(setup.secret)}</code>
            </p>
            <p>
              Или откройте ссылку на телефоне: <a href={setup.otpauthUrl}>добавить в приложение</a>
            </p>
            <p>2. Введите код, который показало приложение.</p>
            {codeInput}
            {errorBox}
            <Button type="submit" disabled={busy}>
              {busy ? 'Проверяем…' : 'Включить'}
            </Button>
          </form>
        )}
        {!setup && errorBox}
      </section>
    )

  if (!status.verified)
    return (
      <section aria-labelledby="mfa-title">
        <h1 id="mfa-title">Подтвердите вход</h1>
        <form onSubmit={verify}>
          {codeInput}
          {errorBox}
          <Button type="submit" disabled={busy || status.locked}>
            {busy ? 'Проверяем…' : 'Войти'}
          </Button>
        </form>
        <p>
          <button
            type="button"
            className="btn btn--style-none"
            onClick={() => {
              setUseRecovery((v) => !v)
              setCode('')
              setError(null)
            }}
          >
            {useRecovery
              ? 'Ввести код из приложения'
              : 'Нет доступа к телефону — код восстановления'}
          </button>
        </p>
      </section>
    )

  return (
    <section aria-labelledby="mfa-title">
      <h1 id="mfa-title">Второй фактор включён</h1>
      <p>Осталось кодов восстановления: {status.recoveryCodesLeft}.</p>
      {errorBox}
      <Button onClick={enterAdmin}>В админку</Button>{' '}
      <Button buttonStyle="secondary" onClick={regenerate} disabled={busy}>
        Новые коды восстановления
      </Button>{' '}
      <Button buttonStyle="secondary" onClick={reset} disabled={busy}>
        Перенастроить на новом телефоне
      </Button>
    </section>
  )
}
