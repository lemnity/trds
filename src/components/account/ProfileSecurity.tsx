'use client'

import { Button, Description, FieldError, Input, Label, TextField } from '@heroui/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { normalizeCode, PASSWORD_MIN } from '@/modules/auth'

import { postJson } from '../auth/api'
import { PasswordField } from '../auth/PasswordField'
import { endSession, IS_STATIC_PREVIEW } from '../auth/session'
import { InlineNotice } from '../ui/InlineNotice'
import styles from './Account.module.css'
import {
  codeFieldError,
  newPasswordError,
  passwordChangeFeedback,
  passwordCodeFeedback,
  type PasswordField as Field,
} from './security-view'

type Errors = Partial<Record<Field, string>>

/**
 * Пароль и сеансы в профиле (T-055). Пароля нет — задать (достаточно входа). Есть — сменить,
 * подтвердив текущим паролем или кодом из письма; после смены остальные устройства выходят.
 * «Выйти на всех устройствах» отзывает все сессии, включая эту. На статическом превью сервера
 * нет — честно говорим, что это работает только на сайте.
 */
export function ProfileSecurity({ hasPassword: initial }: { hasPassword: boolean | null }) {
  const [hasPassword, setHasPassword] = useState(Boolean(initial))
  const [open, setOpen] = useState(false)
  const [proof, setProof] = useState<'current' | 'code'>('current')
  const [current, setCurrent] = useState('')
  const [code, setCode] = useState('')
  const [next, setNext] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [notice, setNotice] = useState<{ text: string; relogin?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [codeState, setCodeState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [done, setDone] = useState('')
  const [confirmAll, setConfirmAll] = useState(false)
  const [allBusy, setAllBusy] = useState(false)
  const [allError, setAllError] = useState('')
  const router = useRouter()

  // Превью или страница без входа: формам некуда отправлять запрос.
  if (IS_STATIC_PREVIEW || initial === null)
    return (
      <>
        <div>
          <dt>Пароль</dt>
          <dd className={styles.securityMuted}>
            Задать или сменить пароль можно на сайте театра после входа.
          </dd>
        </div>
        <div>
          <dt>Сеансы</dt>
          <dd className={styles.securityMuted}>
            «Выйти на всех устройствах» — там же, после входа.
          </dd>
        </div>
      </>
    )

  const reset = () => {
    setCurrent('')
    setCode('')
    setNext('')
    setErrors({})
    setNotice(null)
    setCodeState('idle')
    setProof('current')
  }

  const sendCode = async () => {
    setNotice(null)
    setCodeState('sending')
    const { status, data } = await postJson<{ error?: string; retryAfter?: number }>(
      '/api/account/password/code',
      {},
    )
    if (status === 200 || (status === 429 && data?.error === 'cooldown')) {
      // Код уже в пути (или отправлен минуту назад) — можно вводить.
      setCodeState('sent')
      if (status === 429) setNotice({ text: passwordCodeFeedback(status, data) })
      return
    }
    setCodeState('idle')
    setNotice({ text: passwordCodeFeedback(status, data) })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setNotice(null)
    const found: Errors = {}
    const nextError = newPasswordError(next)
    if (nextError) found.next = nextError
    if (hasPassword && proof === 'current' && !current) found.current = 'Введите текущий пароль'
    if (hasPassword && proof === 'code') {
      const codeError = codeFieldError(code)
      if (codeError) found.code = codeError
    }
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    const { status, data } = await postJson<{ error?: string }>('/api/account/password', {
      next,
      ...(hasPassword && (proof === 'current' ? { current } : { code })),
    })
    setBusy(false)
    if (status === 200) {
      setDone(
        hasPassword
          ? 'Пароль изменён. На других устройствах нужно будет войти заново.'
          : 'Пароль задан. Теперь можно входить по почте и паролю.',
      )
      setHasPassword(true)
      setOpen(false)
      reset()
      return
    }
    const feedback = passwordChangeFeedback(status, data?.error)
    if (feedback.kind === 'field') setErrors({ [feedback.field]: feedback.text })
    else setNotice({ text: feedback.text, relogin: feedback.relogin })
  }

  const logoutEverywhere = async () => {
    setAllBusy(true)
    setAllError('')
    let status = 0
    try {
      const res = await fetch('/api/account/sessions', {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      status = res.status
    } catch {
      status = 0
    }
    setAllBusy(false)
    if (status === 200 || status === 401) {
      // Сессии отозваны (или уже не было) — сбрасываем меню и идём на вход.
      await endSession()
      router.push('/login?next=/account')
      return
    }
    setAllError(
      status === 429
        ? 'Слишком много попыток. Попробуйте через 10 минут.'
        : 'Не получилось: нет связи с сервером. Попробуйте ещё раз.',
    )
  }

  return (
    <>
      <div>
        <dt>Пароль</dt>
        <dd className={styles.security}>
          {!open ? (
            <>
              <span>{hasPassword ? 'Задан' : 'Не задан — входите по коду из письма'}</span>
              <Button
                variant="outline"
                size="sm"
                onPress={() => {
                  setDone('')
                  setOpen(true)
                }}
              >
                {hasPassword ? 'Сменить пароль' : 'Задать пароль'}
              </Button>
              {done && (
                <p className={styles.success} role="status">
                  {done}
                </p>
              )}
            </>
          ) : (
            <form
              className={styles.securityForm}
              onSubmit={submit}
              noValidate
              aria-label={hasPassword ? 'Смена пароля' : 'Новый пароль'}
            >
              {hasPassword && proof === 'current' && (
                <>
                  <PasswordField
                    label="Текущий пароль"
                    autoComplete="current-password"
                    value={current}
                    onChange={(v) => {
                      setCurrent(v)
                      setErrors((e) => ({ ...e, current: undefined }))
                    }}
                    error={errors.current}
                  />
                  <button
                    type="button"
                    className={styles.securityLink}
                    onClick={() => {
                      setProof('code')
                      setErrors({})
                      void sendCode()
                    }}
                  >
                    Не помню — подтвердить кодом из письма
                  </button>
                </>
              )}
              {hasPassword && proof === 'code' && (
                <>
                  <TextField
                    value={code}
                    onChange={(v) => {
                      setCode(normalizeCode(v))
                      setErrors((e) => ({ ...e, code: undefined }))
                    }}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    isRequired
                    isInvalid={Boolean(errors.code)}
                    isDisabled={codeState === 'sending'}
                    validationBehavior="aria"
                  >
                    <Label>Код из письма</Label>
                    <Input maxLength={6} />
                    {errors.code ? (
                      <FieldError>{errors.code}</FieldError>
                    ) : (
                      <Description>
                        {codeState === 'sending'
                          ? 'Отправляем код на вашу почту…'
                          : codeState === 'sent'
                            ? 'Код отправлен на почту кабинета. Действует 10 минут.'
                            : 'Запросите код — он придёт на почту кабинета.'}
                      </Description>
                    )}
                  </TextField>
                  <div className={styles.securityActions}>
                    <button
                      type="button"
                      className={styles.securityLink}
                      disabled={codeState === 'sending'}
                      onClick={() => void sendCode()}
                    >
                      Отправить код ещё раз
                    </button>
                    <button
                      type="button"
                      className={styles.securityLink}
                      onClick={() => {
                        setProof('current')
                        setErrors({})
                        setNotice(null)
                      }}
                    >
                      Ввести текущий пароль
                    </button>
                  </div>
                </>
              )}
              <PasswordField
                label="Новый пароль"
                autoComplete="new-password"
                value={next}
                onChange={(v) => {
                  setNext(v)
                  setErrors((e) => ({ ...e, next: undefined }))
                }}
                error={errors.next}
                description={`Не короче ${PASSWORD_MIN} символов`}
              />
              {notice && (
                <InlineNotice tone="danger" title="Пароль не сохранён">
                  {notice.text} {notice.relogin && <Link href="/login?next=/account">Войти</Link>}
                </InlineNotice>
              )}
              <div className={styles.securityActions}>
                <Button type="submit" isPending={busy}>
                  {busy ? 'Сохраняем…' : 'Сохранить пароль'}
                </Button>
                <Button
                  variant="ghost"
                  onPress={() => {
                    setOpen(false)
                    reset()
                  }}
                >
                  Отмена
                </Button>
              </div>
            </form>
          )}
        </dd>
      </div>
      <div>
        <dt>Сеансы</dt>
        <dd className={styles.security}>
          {!confirmAll ? (
            <Button variant="outline" size="sm" onPress={() => setConfirmAll(true)}>
              Выйти на всех устройствах
            </Button>
          ) : (
            <div className={styles.securityForm} role="group" aria-label="Подтверждение выхода">
              <p>
                Кабинет закроется на всех телефонах и компьютерах, включая этот. Войти снова можно
                по коду из письма{hasPassword ? ' или паролю' : ''}.
              </p>
              {allError && (
                <p className={styles.securityError} role="alert">
                  {allError}
                </p>
              )}
              <div className={styles.securityActions}>
                <Button isPending={allBusy} onPress={() => void logoutEverywhere()}>
                  {allBusy ? 'Выходим…' : 'Выйти везде'}
                </Button>
                <Button variant="ghost" onPress={() => setConfirmAll(false)}>
                  Отмена
                </Button>
              </div>
            </div>
          )}
        </dd>
      </div>
    </>
  )
}
