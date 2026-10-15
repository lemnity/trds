import { ButtonLink } from '../ui/ButtonLink'
import styles from './Checkout.module.css'

// Процент начисления и доля оплаты бонусами ещё не утверждены театром (PRD §5.6, T-060):
// цифр не обещаем — только условие, что бонусы копятся при входе в кабинет.
export function BonusReminder() {
  return (
    <section className={styles.bonus} aria-labelledby="checkout-bonus">
      <svg className={styles.bonusIcon} viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 11h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Zm-1-4h18v4H3V7Zm9 0v14M12 7c-1.5-3.5-6-3.5-6-1s4 1 6 1Zm0 0c1.5-3.5 6-3.5 6-1s-4 1-6 1Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
      <div className={styles.bonusText}>
        <h2 id="checkout-bonus" className={styles.bonusTitle}>
          Войдите в личный кабинет, чтобы копить бонусы
        </h2>
        <p>
          Бонусы начисляются только за заказы, оформленные после входа. Ими можно будет оплатить
          часть следующих билетов. Без входа заказ тоже оформится, но бонусы за него не начислятся.
        </p>
      </div>
      <ButtonLink href="/account" variant="outline" className={styles.bonusAction}>
        Войти в кабинет
      </ButtonLink>
    </section>
  )
}
