'use client'

import { Button, Checkbox, FieldError, Label } from '@heroui/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { InlineNotice } from '../ui/InlineNotice'
import { postJson } from './api'
import { setSignedIn, type Session } from './session'
import { yandexCompleteError } from './yandex-view'
import styles from './Auth.module.css'

/**
 * Подтверждение регистрации через Яндекс ID (T-056): почта и имя пришли из Яндекса, аккаунт
 * создаётся только после согласия на обработку ПД (152-ФЗ) — `POST /api/auth/yandex/complete`.
 * Данные профиля сервер берёт из своей cookie, форма отправляет только согласие.
 */
export function YandexSignupForm({ email, name }: { email: string; name: string | null }) {
  const [consent, setConsent] = useState(false)
  const [consentError, setConsentError] = useState('')
  const [problem, setProblem] = useState<{ text: string; restart: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setProblem(null)
    if (!consent) {
      setConsentError('Без согласия мы не можем создать кабинет')
      return
    }
    setBusy(true)
    const { status, data } = await postJson<{ customer?: Session; next?: string; error?: string }>(
      '/api/auth/yandex/complete',
      { consent: true },
    )
    setBusy(false)
    if (status === 200 && data?.customer) {
      setSignedIn(data.customer)
      router.push(data.next ?? '/account')
      return
    }
    setProblem({
      text: yandexCompleteError(status, data?.error),
      restart: status === 400 && data?.error === 'expired',
    })
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <dl className={styles.yandexProfile}>
        {name && (
          <div>
            <dt>Имя</dt>
            <dd>{name}</dd>
          </div>
        )}
        <div>
          <dt>Почта</dt>
          <dd>{email}</dd>
        </div>
      </dl>
      <Checkbox
        isSelected={consent}
        onChange={(v) => {
          setConsent(v)
          setConsentError('')
        }}
        isRequired
        isInvalid={Boolean(consentError)}
        validationBehavior="aria"
      >
        <Checkbox.Content>
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Label>Согласен на обработку персональных данных</Label>
        </Checkbox.Content>
        <FieldError>{consentError}</FieldError>
      </Checkbox>
      <p className={styles.hint}>
        <Link href="/documents/personal-data" target="_blank" rel="noopener">
          Как мы обрабатываем персональные данные
        </Link>
      </p>
      {problem && (
        <InlineNotice tone="danger" title="Кабинет не создан">
          {problem.text} {problem.restart && <Link href="/register">Начать заново</Link>}
        </InlineNotice>
      )}
      <Button type="submit" fullWidth className={styles.submit} isPending={busy}>
        Создать кабинет
      </Button>
      <p className={styles.hint}>
        Входить можно будет кнопкой «Войти с Яндекс ID» или по коду из письма на эту почту.
      </p>
    </form>
  )
}
