'use client'

import head from './page-head.module.css'
import { Button } from '@heroui/react'

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="container">
      <header className={head.head}>
        <h1 className={head.title}>Что-то пошло не так</h1>
        <p className={head.lead}>
          Не удалось загрузить страницу. Попробуйте ещё раз — если ошибка повторится, позвоните нам:
          +7 982 657-54-26.
        </p>
      </header>
      <Button onPress={reset}>Попробовать снова</Button>
    </div>
  )
}
