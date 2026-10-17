'use client'

import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'

import styles from './PageTabs.module.css'

export type PageTab = { id: string; label: string; count?: number; panel: ReactNode }

/**
 * Вкладки страницы (паттерн ARIA tabs): стрелки и Home/End переключают, адрес `#<id>`
 * открывает нужную вкладку и обновляется при выборе — ссылкой можно поделиться.
 */
export function PageTabs({ tabs, label }: { tabs: PageTab[]; label: string }) {
  const base = useId()
  const [active, setActive] = useState(tabs[0]!.id)

  // Вкладка из адреса (#archive) — после загрузки и при переходе по якорю.
  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1)
      if (tabs.some((t) => t.id === id)) setActive(id)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [tabs])

  const select = (id: string, focus = false) => {
    setActive(id)
    window.history.replaceState(null, '', id === tabs[0]!.id ? window.location.pathname : `#${id}`)
    if (focus) document.getElementById(`${base}-tab-${id}`)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active)
    const next =
      event.key === 'ArrowRight'
        ? (i + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (i - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : -1
    if (next < 0) return
    event.preventDefault()
    select(tabs[next]!.id, true)
  }

  return (
    <div className={styles.tabs}>
      <div role="tablist" aria-label={label} className={styles.list} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`${base}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={tab.id === active ? 0 : -1}
            className={styles.tab}
            onClick={() => select(tab.id)}
          >
            {tab.label}
            {tab.count !== undefined && <span className={styles.count}>{tab.count}</span>}
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
          {tab.panel}
        </div>
      ))}
    </div>
  )
}
