import { formatRub } from '@/lib/money'
import { SERVICE_FEE } from '@/modules/checkout'

import styles from './Checkout.module.css'

export type OrderLine = { key: string; title: string; totalKopecks: number }

type Props = {
  heading: string
  lines: OrderLine[]
  ticketCount: number
  feeKopecks: number
  totalKopecks: number
}

/** «Ваши места»: позиции, сервисный сбор, сумма к оплате (референс заказчика). */
export function CheckoutSummary({ heading, lines, ticketCount, feeKopecks, totalKopecks }: Props) {
  return (
    <aside className={styles.summary} aria-labelledby="checkout-summary">
      <h2 id="checkout-summary" className={styles.summaryTitle}>
        {heading}
      </h2>
      <ul className={styles.lines}>
        {lines.map((line) => (
          <li key={line.key} className={styles.line}>
            <span>{line.title}</span>
            <span className={styles.amount}>{formatRub(line.totalKopecks)}</span>
          </li>
        ))}
        <li className={styles.line}>
          <span>
            Сервисный сбор × {ticketCount}
            {SERVICE_FEE.placeholder && (
              <span className={styles.placeholder}> · предварительно</span>
            )}
          </span>
          <span className={styles.amount}>{formatRub(feeKopecks)}</span>
        </li>
      </ul>
      <p className={styles.total}>
        <span>К оплате</span>
        <span className={styles.totalAmount}>{formatRub(totalKopecks)}</span>
      </p>
      <p className={styles.note}>Электронные билеты придут на почту сразу после оплаты.</p>
    </aside>
  )
}
