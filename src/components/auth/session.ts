'use client'

import { useSyncExternalStore } from 'react'

/**
 * Сессия зрителя на стороне браузера. ДЕМО до T-050: настоящей сессии (HttpOnly cookie) нет —
 * прототип формы входа кладёт сюда имя и почту, чтобы можно было посмотреть меню вошедшего.
 * Это не авторизация и ничего не защищает; с T-050 источник заменяется ответом сервера.
 */
export type DemoSession = { name: string; email: string; demo: true }

const KEY = 'turdus:demo-session'
const EVENT = 'turdus:session'

const read = (): string | null => {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

/** Текущая сессия или null. На сервере и до гидрации — null (как у гостя). */
export function useSession(): DemoSession | null {
  const raw = useSyncExternalStore(subscribe, read, () => null)
  if (!raw) return null
  try {
    return JSON.parse(raw) as DemoSession
  } catch {
    return null
  }
}

export function startDemoSession(session: { name: string; email: string }) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...session, demo: true }))
  } catch {
    // Хранилище недоступно (приватный режим) — меню останется гостевым.
  }
  window.dispatchEvent(new Event(EVENT))
}

export function endSession() {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Нечего удалять.
  }
  window.dispatchEvent(new Event(EVENT))
}
