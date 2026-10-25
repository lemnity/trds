'use client'

import { useSyncExternalStore } from 'react'

import { IS_STATIC_PREVIEW } from './session'

/**
 * Включён ли вход через Яндекс ID на сервере (`GET /api/auth/providers`). Страницы входа
 * статические, поэтому спрашиваем в браузере один раз. На превью без сервера — выключен.
 * null — ещё не знаем (кнопку не показываем, чтобы не мигала).
 */
let enabled: boolean | null = IS_STATIC_PREVIEW ? false : null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

const load = () => {
  loading ??= fetch('/api/auth/providers', { cache: 'no-store', credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : { yandex: false }))
    .then((data: { yandex?: boolean }) => {
      enabled = data.yandex === true
    })
    .catch(() => {
      enabled = false
    })
    .finally(() => listeners.forEach((l) => l()))
  return loading
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  if (!IS_STATIC_PREVIEW) void load()
  return () => listeners.delete(cb)
}

export const useYandexEnabled = (): boolean | null =>
  useSyncExternalStore(
    subscribe,
    () => enabled,
    () => null,
  )

const noSubscribe = () => () => {}
const readParam = () => new URLSearchParams(window.location.search).get('yandex')

/** Исход возврата с Яндекса из адреса (`?yandex=`); на сервере — null. */
export const useYandexParam = () => useSyncExternalStore(noSubscribe, readParam, () => null)
