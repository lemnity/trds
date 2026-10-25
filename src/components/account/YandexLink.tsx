'use client'

import { Button } from '@heroui/react'
import Link from 'next/link'
import { useState } from 'react'

import { IS_STATIC_PREVIEW } from '../auth/session'
import { useYandexEnabled, useYandexParam } from '../auth/useYandex'
import { yandexLinkNotice } from '../auth/yandex-view'
import { InlineNotice } from '../ui/InlineNotice'
import styles from './Account.module.css'

/**
 * «Яндекс ID» в профиле (T-056): привязать (POST-форма на /api/auth/yandex/start, mode=link —
 * переход на Яндекс и обратно сюда с `?yandex=linked`) или отвязать (`DELETE
 * /api/auth/yandex/link`). Отвязать можно и без пароля: вход кодом на почту кабинета остаётся.
 * Без настроек на сервере — честно «пока не подключён»; на превью — только на сайте.
 */
export function YandexLink({
  linked: initial,
  hasPassword,
}: {
  linked: boolean | null
  hasPassword: boolean
}) {
  const [linked, setLinked] = useState(Boolean(initial))
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; relogin?: boolean } | null>(null)
  const [done, setDone] = useState('')
  const enabled = useYandexEnabled()
  const fromCallback = yandexLinkNotice(useYandexParam())
  const notice = done ? null : fromCallback

  if (IS_STATIC_PREVIEW || initial === null)
    return (
      <div>
        <dt>Яндекс ID</dt>
        <dd className={styles.securityMuted}>
          Привязать Яндекс ID можно на сайте театра после входа.
        </dd>
      </div>
    )

  const unlink = async () => {
    setBusy(true)
    setError(null)
    let status = 0
    try {
      status = (
        await fetch('/api/auth/yandex/link', { method: 'DELETE', credentials: 'same-origin' })
      ).status
    } catch {
      status = 0
    }
    setBusy(false)
    if (status === 200) {
      setLinked(false)
      setConfirm(false)
      setDone('Яндекс ID отвязан.')
      return
    }
    setError(
      status === 401
        ? { text: 'Сессия закончилась — войдите снова.', relogin: true }
        : status === 429
          ? { text: 'Слишком много попыток. Попробуйте через 10 минут.' }
          : { text: 'Не получилось: нет связи с сервером. Попробуйте ещё раз.' },
    )
  }

  return (
    <div>
      <dt>Яндекс ID</dt>
      <dd className={styles.security}>
        {notice && (
          <InlineNotice tone={notice.tone} title={notice.title}>
            {notice.text}
          </InlineNotice>
        )}
        {linked && !confirm && (
          <>
            <span>Привязан — можно входить кнопкой «Войти с Яндекс ID»</span>
            <Button variant="outline" size="sm" onPress={() => setConfirm(true)}>
              Отвязать
            </Button>
          </>
        )}
        {linked && confirm && (
          <div className={styles.securityForm} role="group" aria-label="Отвязать Яндекс ID">
            <p>
              Входить через Яндекс больше не получится. В кабинет можно будет войти по коду из
              письма{hasPassword ? ' или паролю' : ''}.
            </p>
            {error && (
              <p className={styles.securityError} role="alert">
                {error.text} {error.relogin && <Link href="/login?next=/account">Войти</Link>}
              </p>
            )}
            <div className={styles.securityActions}>
              <Button isPending={busy} onPress={() => void unlink()}>
                {busy ? 'Отвязываем…' : 'Отвязать'}
              </Button>
              <Button variant="ghost" onPress={() => setConfirm(false)}>
                Отмена
              </Button>
            </div>
          </div>
        )}
        {!linked && enabled && (
          <>
            <span>Не привязан</span>
            <form method="post" action="/api/auth/yandex/start" onSubmit={() => setBusy(true)}>
              <input type="hidden" name="mode" value="link" />
              <Button type="submit" variant="outline" size="sm" isPending={busy}>
                Привязать Яндекс ID
              </Button>
            </form>
          </>
        )}
        {!linked && enabled === false && (
          <span className={styles.securityMuted}>Вход через Яндекс ID пока не подключён</span>
        )}
        {done && (
          <p className={styles.success} role="status">
            {done}
          </p>
        )}
      </dd>
    </div>
  )
}
