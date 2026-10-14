'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import styles from './ShowTabs.module.css'

export type ShowTab = { id: string; label: string; content: ReactNode }

/** Вкладки по паттерну WAI-ARIA Tabs: стрелки переключают, Home/End — к краям. */
export function ShowTabs({ tabs }: { tabs: ShowTab[] }) {
  const base = useId()
  const [active, setActive] = useState(tabs[0]?.id)
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const rootRef = useRef<HTMLDivElement>(null)

  // Ссылка вида #photos открывает нужную вкладку (например, из медиа-карточки сайдбара).
  useEffect(() => {
    const ids = new Set(tabs.map((t) => t.id))
    const onHash = () => {
      const id = window.location.hash.slice(1)
      if (!ids.has(id)) return
      setActive(id)
      rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [tabs])

  const activate = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length]!
    setActive(tab.id)
    refs.current.get(tab.id)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    activate(next)
  }

  // Одна вкладка — переключать нечего: показываем раздел без списка вкладок.
  if (tabs.length === 1) return <div className={styles.tabs}>{tabs[0]!.content}</div>

  return (
    <div ref={rootRef} className={styles.tabs}>
      <div role="tablist" aria-label="Разделы о спектакле" className={styles.list}>
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) refs.current.set(tab.id, el)
              else refs.current.delete(tab.id)
            }}
            id={`${base}-tab-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={tab.id === active}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={tab.id === active ? 0 : -1}
            onClick={() => setActive(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${base}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={tab.id !== active}
          tabIndex={0}
          className={styles.panel}
        >
          {tab.content}
        </div>
      ))}
    </div>
  )
}
