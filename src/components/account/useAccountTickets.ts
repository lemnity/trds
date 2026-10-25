'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

import { IS_STATIC_PREVIEW, useSession } from '../auth/session'
import { demoAccountTickets, demoQrContent } from './tickets-demo'
import type { AccountTickets } from './tickets-view'

/**
 * Билеты зрителя в браузере (T-051).
 * - Сервер: `GET /api/account/tickets`, одна загрузка на страницу, общая для цифр сверху
 *   и раздела «Мои билеты»; «Повторить» — перезагрузка.
 * - Статическое превью: ДЕМО (tickets-demo.ts), только при демо-входе; QR рисуется в браузере.
 */
export type TicketsState =
  | { status: 'loading' }
  | { status: 'guest' }
  | { status: 'unavailable' }
  | { status: 'ready'; data: AccountTickets; demo: boolean }

const LOADING: TicketsState = { status: 'loading' }
let current: TicketsState = LOADING
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

const fetchTickets = async (): Promise<TicketsState> => {
  try {
    const res = await fetch('/api/account/tickets', {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (res.status === 401) return { status: 'guest' }
    if (!res.ok) return { status: 'unavailable' }
    return { status: 'ready', data: (await res.json()) as AccountTickets, demo: false }
  } catch {
    return { status: 'unavailable' }
  }
}

const load = (force = false) => {
  if (force || !loading)
    loading = fetchTickets().then((next) => {
      current = next
      notify()
    })
  return loading
}

const subscribeServer = (cb: () => void) => {
  listeners.add(cb)
  void load()
  return () => listeners.delete(cb)
}
const noopSubscribe = () => () => {}

/** Повторить загрузку после ошибки. */
export const reloadTickets = () => {
  if (IS_STATIC_PREVIEW) return Promise.resolve()
  current = LOADING
  notify()
  return load(true)
}

/** Демо: билеты на показы превью и QR-картинки (GIF data URL) со строкой «DEMO». */
const buildDemo = async (): Promise<AccountTickets> => {
  const data = demoAccountTickets(new Date())
  const { default: qrcode } = await import('qrcode-generator')
  const qr = (text: string) => {
    const code = qrcode(0, 'M')
    code.addData(text, 'Byte')
    code.make()
    return code.createDataURL(8, 4)
  }
  return {
    ...data,
    upcoming: data.upcoming.map((t) => ({ ...t, qrUrl: qr(demoQrContent(t.number)) })),
  }
}

export function useAccountTickets(): TicketsState {
  const session = useSession()
  const server = useSyncExternalStore(
    IS_STATIC_PREVIEW ? noopSubscribe : subscribeServer,
    () => (IS_STATIC_PREVIEW ? LOADING : current),
    () => LOADING,
  )
  const [demo, setDemo] = useState<AccountTickets | null>(null)
  const isDemo = IS_STATIC_PREVIEW && Boolean(session)

  useEffect(() => {
    if (!isDemo || demo) return
    let alive = true
    void buildDemo().then((d) => {
      if (alive) setDemo(d)
    })
    return () => {
      alive = false
    }
  }, [isDemo, demo])

  if (!IS_STATIC_PREVIEW) return server
  if (!session) return { status: 'guest' }
  return demo ? { status: 'ready', data: demo, demo: true } : LOADING
}
