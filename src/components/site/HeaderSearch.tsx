'use client'

import { Button, SearchField } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import styles from './SiteHeader.module.css'

const SearchIcon = ({ size = 22 }: { size?: number }) => (
  <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true">
    <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <path d="M13.2 13.2 17 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
)

/**
 * Поиск в шапке: кнопка-лупа открывает поле под шапкой; запрос ведёт в афишу
 * (/afisha?q=…), где он ищется по названиям, жанрам и площадкам. Esc и клик мимо закрывают.
 */
export function HeaderSearch() {
  const ids = useId()
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const q = query.trim()
    setOpen(false)
    router.push(q ? `/afisha?q=${encodeURIComponent(q)}` : '/afisha')
  }

  return (
    // Кнопка с подсказкой — в своей обёртке (подсказка у кнопки); панель — от шапки.
    <div ref={rootRef} className={styles.searchRoot}>
      <span className={styles.tipWrap}>
        <Button
          variant="ghost"
          isIconOnly
          className={styles.lowVision}
          aria-label="Поиск по афише"
          aria-expanded={open}
          aria-controls={`${ids}-search`}
          onPress={() => setOpen(!open)}
        >
          <SearchIcon />
        </Button>
        {!open && (
          <span className={styles.tip} aria-hidden="true">
            Поиск
          </span>
        )}
      </span>
      <div id={`${ids}-search`} className={styles.searchPanel} hidden={!open}>
        <form role="search" className={`container ${styles.searchForm}`} onSubmit={submit}>
          <SearchField
            aria-label="Поиск по афише"
            value={query}
            onChange={setQuery}
            className={styles.searchField}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input ref={inputRef} placeholder="Спектакль, жанр или площадка" />
              <SearchField.ClearButton aria-label="Очистить поиск" />
            </SearchField.Group>
          </SearchField>
          <Button type="submit">Найти</Button>
        </form>
      </div>
    </div>
  )
}
