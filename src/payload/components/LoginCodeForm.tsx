'use client'

import { Button } from '@payloadcms/ui'
import { useState, type FormEvent } from 'react'

const field: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.6rem 0.75rem',
  fontSize: '1.1rem',
  marginTop: '0.5rem',
}

const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60))

/**
 * Вход в админку, шаг 1 из 2: почта → код из письма. Шаг 2 — код из приложения на /admin/mfa
 * (туда переводит MfaGate). Решения принимает сервер (src/payload/auth/codeLogin.ts).
 */
export function LoginCodeForm({ apiUrl, nextUrl }: { apiUrl: string; nextUrl: string }) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const post = async (path: string, body: unknown) => {
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
      return { ok: res.ok, data }
    } catch {
      setError('Нет связи с сервером. Попробуйте ещё раз.')
      return null
    } finally {
      setBusy(false)
    }
  }

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault()
    const r = await post('/code', { email })
    if (!r) return
    if (r.ok || r.data.code === 'cooldown') {
      setStep('code')
      setCode('')
      setNotice(
        r.ok
          ? `Если ${email.trim()} есть в списке сотрудников, на неё пришло письмо с кодом. Код действует 10 минут. Супер-админ вводит код из приложения-аутентификатора.`
          : 'Код уже отправлен — проверьте почту, в том числе папку «Спам».',
      )
      return
    }
    if (r.data.code === 'too_many' && typeof r.data.retryAfter === 'number')
      setError(`Слишком много писем. Попробуйте через ${minutes(r.data.retryAfter)} мин.`)
    else setError(String(r.data.message ?? 'Не удалось отправить код. Попробуйте ещё раз.'))
  }

  const login = async (e: FormEvent) => {
    e.preventDefault()
    const r = await post('/login', { email, code })
    if (!r) return
    // Полная перезагрузка: сессия в новой cookie, дальше MfaGate попросит код из приложения.
    if (r.ok) window.location.assign(nextUrl)
    else setError(String(r.data.message ?? 'Код не подошёл. Попробуйте ещё раз.'))
  }

  const errorBox = error && (
    <p id="login-error" role="alert" style={{ color: 'var(--theme-error-500)' }}>
      {error}
    </p>
  )

  if (step === 'email')
    return (
      <section aria-labelledby="login-title">
        <h1 id="login-title">Вход в админку</h1>
        <p>
          Введите рабочую почту — пришлём код. Затем понадобится код из приложения-аутентификатора.
        </p>
        <form onSubmit={sendCode}>
          <label style={{ display: 'block', margin: '1rem 0' }}>
            Почта
            <input
              style={field}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </label>
          {errorBox}
          <Button type="submit" disabled={busy}>
            {busy ? 'Отправляем…' : 'Получить код'}
          </Button>
        </form>
      </section>
    )

  return (
    <section aria-labelledby="login-title">
      <h1 id="login-title">Код подтверждения</h1>
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={login}>
        <label style={{ display: 'block', margin: '1rem 0' }}>
          Код из письма или приложения (6 цифр)
          <input
            style={{ ...field, fontSize: '1.25rem', letterSpacing: '0.2em' }}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            required
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'login-error' : undefined}
          />
        </label>
        {errorBox}
        <Button type="submit" disabled={busy}>
          {busy ? 'Проверяем…' : 'Продолжить'}
        </Button>
      </form>
      <p>
        <button
          type="button"
          className="btn btn--style-none"
          onClick={() => sendCode()}
          disabled={busy}
        >
          Отправить код ещё раз
        </button>
        {' · '}
        <button
          type="button"
          className="btn btn--style-none"
          onClick={() => {
            setStep('email')
            setError(null)
            setNotice(null)
          }}
        >
          Другая почта
        </button>
      </p>
    </section>
  )
}
