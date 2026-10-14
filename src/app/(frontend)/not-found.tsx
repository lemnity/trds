import { ButtonLink } from '@/components/ui/ButtonLink'

import head from './page-head.module.css'

export default function NotFound() {
  return (
    <div className="container">
      <header className={head.head}>
        <h1 className={head.title}>Такой страницы нет</h1>
        <p className={head.lead}>Возможно, показ уже прошёл или ссылка устарела.</p>
      </header>
      <ButtonLink href="/afisha">Открыть афишу</ButtonLink>
    </div>
  )
}
