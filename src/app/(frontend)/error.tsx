'use client'

import buttons from '@/components/ui/button.module.css'

import head from './page-head.module.css'

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
      <button type="button" className={buttons.button} onClick={reset}>
        Попробовать снова
      </button>
    </div>
  )
}
