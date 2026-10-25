'use client'

import { useEffect, useMemo, useSyncExternalStore } from 'react'

import { postJson } from '../auth/api'
import { IS_STATIC_PREVIEW, useSession } from '../auth/session'
import {
  DEMO_LOYALTY_KEY,
  activateDemoCertificate,
  createDemoState,
  demoSummary,
  parseDemoState,
  type DemoLoyaltyState,
} from './loyalty-demo'
import type { LoyaltySummary } from './loyalty-view'

/**
 * Бонусы зрителя в браузере.
 * - Сервер: `GET /api/loyalty/summary`, одна загрузка на страницу, общая для всех блоков
 *   кабинета (цифры сверху, бонусы, сертификат); после активации — перезагрузка.
 * - Статическое превью: ДЕМО-набор в localStorage (см. loyalty-demo.ts), только при демо-входе.
 */
export type LoyaltyState =
  | { status: 'loading' }
  | { status: 'guest' }
  | { status: 'unavailable' }
  | { status: 'ready'; data: LoyaltySummary; demo: boolean }

export type ActivationResult =
  | { ok: true; amountKopecks: number; expiresAt: string }
  | { ok: false; status: number; error: string | null }

// --- Сервер: состояние в памяти страницы. ---
const LOADING: LoyaltyState = { status: 'loading' }
let current: LoyaltyState = LOADING
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

const fetchSummary = async (): Promise<LoyaltyState> => {
  try {
    const res = await fetch('/api/loyalty/summary', {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (res.status === 401) return { status: 'guest' }
    if (!res.ok) return { status: 'unavailable' }
    return { status: 'ready', data: (await res.json()) as LoyaltySummary, demo: false }
  } catch {
    return { status: 'unavailable' }
  }
}

const load = (force = false) => {
  if (force || !loading)
    loading = fetchSummary().then((next) => {
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

/** Повторить загрузку (кнопка «Повторить» и после активации сертификата). */
export const reloadLoyalty = (showLoading = false) => {
  if (IS_STATIC_PREVIEW) return Promise.resolve()
  // После активации старые цифры остаются на экране до прихода новых — без мигания.
  if (showLoading) {
    current = LOADING
    notify()
  }
  return load(true)
}

// --- Превью: localStorage. ---
const DEMO_EVENT = 'turdus:demo-loyalty'

/** Запасной вариант, если localStorage недоступен: демо живёт до перезагрузки страницы. */
let memoryDemoRaw: string | null = null

const readDemoRaw = (): string | null => {
  try {
    return window.localStorage.getItem(DEMO_LOYALTY_KEY) ?? memoryDemoRaw
  } catch {
    return memoryDemoRaw
  }
}

const writeDemo = (state: DemoLoyaltyState) => {
  memoryDemoRaw = JSON.stringify(state)
  try {
    window.localStorage.setItem(DEMO_LOYALTY_KEY, memoryDemoRaw)
  } catch {
    // Хранилище недоступно (приватный режим) — остаётся копия в памяти.
  }
  window.dispatchEvent(new Event(DEMO_EVENT))
}

const subscribeDemo = (cb: () => void) => {
  window.addEventListener(DEMO_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(DEMO_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

const noopSubscribe = () => () => {}

const demoOrigin = () => `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}`

const currentDemoState = () => parseDemoState(readDemoRaw()) ?? createDemoState(new Date())

/** Бонусы текущего зрителя. На сервере и до гидрации — «загрузка». */
export function useLoyalty(): LoyaltyState {
  const session = useSession()
  const server = useSyncExternalStore(
    IS_STATIC_PREVIEW ? noopSubscribe : subscribeServer,
    () => (IS_STATIC_PREVIEW ? LOADING : current),
    () => LOADING,
  )
  const demoRaw = useSyncExternalStore(
    IS_STATIC_PREVIEW ? subscribeDemo : noopSubscribe,
    () => (IS_STATIC_PREVIEW ? readDemoRaw() : null),
    () => null,
  )
  const isDemo = IS_STATIC_PREVIEW && Boolean(session)

  // Первое открытие кабинета в демо — сохранить начальный набор (его читает и демо-оформление).
  useEffect(() => {
    if (isDemo && !parseDemoState(readDemoRaw())) writeDemo(currentDemoState())
  }, [isDemo, demoRaw])

  return useMemo<LoyaltyState>(() => {
    if (!IS_STATIC_PREVIEW) return server
    if (!session) return { status: 'guest' }
    const state = parseDemoState(demoRaw)
    if (!state) return LOADING
    return { status: 'ready', data: demoSummary(state, demoOrigin()), demo: true }
  }, [server, session, demoRaw])
}

/** Активация сертификата: на сервере — API, на превью — демо (с короткой паузой, как у сети). */
export async function activateCertificate(code: string): Promise<ActivationResult> {
  if (IS_STATIC_PREVIEW) {
    await new Promise((r) => setTimeout(r, 500))
    const result = activateDemoCertificate(currentDemoState(), code, new Date())
    if (!result.ok)
      return {
        ok: false,
        status: result.error === 'not_available' ? 422 : 400,
        error: result.error,
      }
    writeDemo(result.state)
    return { ok: true, amountKopecks: result.amountKopecks, expiresAt: result.expiresAt }
  }
  const { status, data } = await postJson<{
    ok?: boolean
    amountKopecks?: number
    expiresAt?: string
    error?: string
  }>('/api/loyalty/certificates/activate', { code })
  if (status === 200 && data?.ok && typeof data.amountKopecks === 'number' && data.expiresAt) {
    void reloadLoyalty()
    return { ok: true, amountKopecks: data.amountKopecks, expiresAt: data.expiresAt }
  }
  return { ok: false, status, error: data?.error ?? null }
}
