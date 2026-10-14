import type { Metadata } from 'next'

import { ButtonLink } from '@/components/ui/ButtonLink'

import head from '../page-head.module.css'
import styles from './account.module.css'

export const metadata: Metadata = {
  title: 'Личный кабинет',
  robots: { index: false, follow: false },
}

// Вход по коду из письма и «Мои билеты» — T-050/T-051. До них — честное объяснение без формы входа.
export default function AccountPage() {
  return (
    <div className="container">
      <header className={head.head}>
        <h1 className={head.title}>Личный кабинет</h1>
        <p className={head.lead}>
          Здесь будут ваши билеты, возвраты и бонусы. Кабинет откроется вместе с продажей билетов на
          этом сайте.
        </p>
      </header>

      <div className={styles.card}>
        <h2 className={styles.title}>Где мои билеты сейчас?</h2>
        <p>
          Пока билеты продаются через текущий сайт театра — электронный билет приходит на почту,
          указанную при покупке. Если письмо не пришло, проверьте папку «Спам» или свяжитесь с
          театром: <a href="tel:+79826575426">+7 982 657-54-26</a>,{' '}
          <a href="mailto:rechevik@inbox.ru">rechevik@inbox.ru</a>.
        </p>
        <ButtonLink href="/afisha">
          Перейти в афишу <span aria-hidden="true">→</span>
        </ButtonLink>
      </div>
    </div>
  )
}
