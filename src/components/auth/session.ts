'use client'

import { useSyncExternalStore } from 'react'

/**
 * Сессия зрителя в браузере.
 * - На сервере (обычный режим): источник — `/api/auth/session` (HttpOnly cookie, T-050);
 *   выход отзывает сессию в базе.
 * - На статическом превью (GitHub Pages, сервера нет): ДЕМО — имя и почта в localStorage,
 *   чтобы можно было посмотреть меню; это не авторизация.
 */
export type Session = { name: string | null; email: string; demo?: boolean }

export const IS_STATIC_PREVIEW = process.env.NEXT_PUBLIC_STATIC_PREVIEW === '1'

const KEY = 'turdus:demo-session'
const EVENT = 'turdus:session'

// --- Сервер: состояние в памяти страницы, загрузка один раз. ---
let current: Session | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

const load = () => {
  loading ??= fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : { customer: null }))
    .then((data: { customer: Session | null }) => {
      current = data.customer
      notify()
    })
    .catch(() => undefined)
  return loading
}

const subscribeServer = (cb: () => void) => {
  listeners.add(cb)
  void load()
  return () => listeners.delete(cb)
}

// --- Превью: localStorage. ---
const readDemo = (): string | null => {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

const subscribeDemo = (cb: () => void) => {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

const parseDemo = (raw: string | null): Session | null => {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Session
  } catch {
    return null
  }
}

/** Текущая сессия или null. На сервере и до гидрации — null (как у гостя). */
export function useSession(): Session | null {
  const demo = useSyncExternalStore(
    IS_STATIC_PREVIEW ? subscribeDemo : () => () => {},
    IS_STATIC_PREVIEW ? readDemo : () => null,
    () => null,
  )
  const server = useSyncExternalStore(
    IS_STATIC_PREVIEW ? () => () => {} : subscribeServer,
    () => (IS_STATIC_PREVIEW ? null : current),
    () => null,
  )
  return IS_STATIC_PREVIEW ? parseDemo(demo) : server
}

/** После успешной проверки кода на сервере — сессия уже в cookie, обновляем меню. */
export function setSignedIn(session: Session) {
  current = session
  notify()
}

/** Демо-вход превью (только без сервера). */
export function startDemoSession(session: { name: string; email: string }) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...session, demo: true }))
  } catch {
    // Хранилище недоступно (приватный режим) — меню останется гостевым.
  }
  window.dispatchEvent(new Event(EVENT))
}

export async function endSession() {
  if (IS_STATIC_PREVIEW) {
    try {
      window.localStorage.removeItem(KEY)
    } catch {
      // Нечего удалять.
    }
    window.dispatchEvent(new Event(EVENT))
    return
  }
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(
    () => undefined,
  )
  current = null
  notify()
}

/** Имя для кнопки меню: имя, иначе часть почты до @. */
export const displayName = (s: Session) =>
  s.name?.split(' ')[0] || s.email.split('@')[0] || 'Кабинет'
