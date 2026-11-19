'use client'

import { Button } from '@payloadcms/ui'
import type { MouseEvent } from 'react'

import styles from './tabNav.module.css'

/**
 * Кнопки «Назад» / «Далее» внизу вкладки формы: переход на соседнюю вкладку того же поля tabs.
 * Активная вкладка — внутреннее состояние Payload (Tabs), поэтому переключаем так же, как
 * пользователь: нажатием на заголовок соседней вкладки; Payload сам запомнит выбор.
 */
type Props = {
  index: number
  prevLabel?: string
  nextLabel?: string
}

const switchTab = (event: MouseEvent<Element>, target: number) => {
  const tabsField = event.currentTarget.closest<HTMLElement>('.tabs-field')
  if (!tabsField) return
  const buttons = tabsField.querySelectorAll<HTMLButtonElement>(
    ':scope > .tabs-field__tabs-wrap .tabs-field__tab-button',
  )
  buttons[target]?.click()
  tabsField.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

export function TabNav({ index, prevLabel, nextLabel }: Props) {
  if (!prevLabel && !nextLabel) return null
  return (
    <div className={styles.nav}>
      {prevLabel ? (
        <Button
          type="button"
          buttonStyle="secondary"
          size="medium"
          onClick={(e: MouseEvent<Element>) => switchTab(e, index - 1)}
        >
          ← Назад: {prevLabel}
        </Button>
      ) : (
        <span />
      )}
      {nextLabel && (
        <Button
          type="button"
          buttonStyle="primary"
          size="medium"
          onClick={(e: MouseEvent<Element>) => switchTab(e, index + 1)}
        >
          Далее: {nextLabel} →
        </Button>
      )}
    </div>
  )
}
