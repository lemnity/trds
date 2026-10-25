'use client'

import { Button } from '@heroui/react'
import { useState, useSyncExternalStore } from 'react'

import { normalizeReferralCode } from '@/modules/loyalty'

import { InlineNotice } from '../ui/InlineNotice'
import { returnPath } from './api'
import { useSession } from './session'
import { useYandexEnabled, useYandexParam } from './useYandex'
import { yandexSignInNotice } from './yandex-view'
import styles from './Auth.module.css'

const noSubscribe = () => () => {}
const readNext = () => returnPath()
const readInvite = () =>
  normalizeReferralCode(new URLSearchParams(window.location.search).get('ref'))

/**
 * «Войти с Яндекс ID» над формой входа/регистрации (T-056). Обычная форма POST на
 * /api/auth/yandex/start (сервер проверяет Origin и уводит на oauth.yandex.ru). Без настроек
 * YANDEX_* на сервере и на статическом превью кнопки нет; ошибка возврата с Яндекса
 * (`?yandex=`) показывается над формой и без кнопки.
 */
export function YandexButton({ mode }: { mode: 'login' | 'register' }) {
  const enabled = useYandexEnabled()
  const notice = yandexSignInNotice(useYandexParam())
  const next = useSyncExternalStore(noSubscribe, readNext, () => '/account')
  const session = useSession()
  const urlInvite = useSyncExternalStore(noSubscribe, readInvite, () => null)
  // Приглашение — только для новых, как в регистрации по коду.
  const invite = mode === 'register' && !session ? urlInvite : null
  const [busy, setBusy] = useState(false)

  return (
    <>
      {notice && (
        <InlineNotice tone={notice.tone} title={notice.title}>
          {notice.text}
        </InlineNotice>
      )}
      {enabled && (
        <form
          method="post"
          action="/api/auth/yandex/start"
          className={styles.form}
          onSubmit={() => setBusy(true)}
        >
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="next" value={next} />
          {invite && <input type="hidden" name="ref" value={invite} />}
          <Button type="submit" variant="outline" fullWidth isPending={busy}>
            {mode === 'register' ? 'Зарегистрироваться с Яндекс ID' : 'Войти с Яндекс ID'}
          </Button>
          <p className={styles.alt}>
            <span className={styles.or}>или по почте</span>
          </p>
        </form>
      )}
    </>
  )
}
