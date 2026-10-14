'use client'

import { useSyncExternalStore, type ReactNode } from 'react'

const noopSubscribe = () => () => {}

/**
 * Статическая сборка фиксирует список показов на момент build. В браузере скрываем
 * уже начавшиеся, чтобы прошедшая дата не выдавалась за ближайшую (WEB-02).
 */
export function HideWhenStarted({ startsAt, children }: { startsAt: string; children: ReactNode }) {
  const started = useSyncExternalStore(
    noopSubscribe,
    () => Date.parse(startsAt) <= Date.now(),
    () => false,
  )
  return started ? null : children
}
