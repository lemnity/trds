'use client'

import { ToggleButton } from '@heroui/react'
import { useReducer, useSyncExternalStore } from 'react'

import { LOW_VISION_KEY } from './lowVision'
import styles from './SiteHeader.module.css'

const noopSubscribe = () => () => {}

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
    <path
      d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="3.2" fill="currentColor" />
  </svg>
)

/**
 * «Версия для слабовидящих»: крупный текст, высокий контраст, ч/б картинки
 * (`html[data-low-vision]`, стили в globals.css). Выбор запоминается в браузере.
 */
export function LowVisionToggle() {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const enabled = useSyncExternalStore(
    noopSubscribe,
    () => document.documentElement.dataset.lowVision === '1',
    () => false,
  )

  const toggle = (on: boolean) => {
    const root = document.documentElement
    if (on) root.dataset.lowVision = '1'
    else delete root.dataset.lowVision
    try {
      if (on) localStorage.setItem(LOW_VISION_KEY, '1')
      else localStorage.removeItem(LOW_VISION_KEY)
    } catch {
      // Хранилище недоступно (приватный режим) — режим действует до перезагрузки.
    }
    rerender()
  }

  return (
    // Подпись — подсказкой при наведении и фокусе; имя кнопки для дикторов — aria-label.
    <span className={styles.tipWrap}>
      <ToggleButton
        isSelected={enabled}
        onChange={toggle}
        variant="ghost"
        isIconOnly
        className={styles.lowVision}
        aria-label="Версия для слабовидящих"
      >
        <EyeIcon />
      </ToggleButton>
      <span className={styles.tip} aria-hidden="true">
        {enabled ? 'Обычная версия' : 'Версия для слабовидящих'}
      </span>
    </span>
  )
}
