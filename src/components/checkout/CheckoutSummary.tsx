import { Button, CloseButton } from '@heroui/react'
import Image from 'next/image'
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'

import { formatRub } from '@/lib/money'
import { formatPerformanceDate, type SalePerformance } from '@/modules/shows'

import { VenueTag } from '../ui/VenueTag'
import { cardClass } from '../ui/card'
import styles from './Checkout.module.css'

export type OrderLine = {
  key: string
  title: string
  /** «Категория 1 · центр» или количество для билетов без мест. */
  subtitle?: string
  /** Цвет полоски — цвет категории на схеме. */
  accent?: string
  totalKopecks: number
  onRemove?: () => void
}

type Props = {
  performance: SalePerformance
  lines: OrderLine[]
  ticketCount: number
  totalKopecks: number
  /** id формы контактов: кнопка оплаты стоит в сводке, но отправляет её. */
  formId: string
  /** Живой регион под кнопкой: сообщения об оплате. */
  status: ReactNode
}

/** Сводка-«билет»: показ, позиции, итог и кнопка оплаты. На десктопе прилипает к экрану. */
export function CheckoutSummary({
  performance,
  lines,
  ticketCount,
  totalKopecks,
  formId,
  status,
}: Props) {
  const date = formatPerformanceDate(performance.startsAt)
  return (
    <aside className={cardClass(styles.summary)} aria-labelledby="checkout-summary">
      <div className={styles.cover}>
        <Image src={performance.show.imageUrl} alt="" fill sizes="(min-width: 60rem) 30vw, 100vw" />
      </div>
      <div className={styles.show}>
        <h2 id="checkout-summary" className={styles.showTitle}>
          {performance.show.title}
        </h2>
        <p className={styles.when}>
          {date.longDate}, {date.weekday} · {date.time}
        </p>
        <p className={styles.where}>
          <VenueTag kind={performance.venue.kind} />
          <span>
            {performance.venue.title}
            <span className={styles.address}>{performance.venue.address}</span>
          </span>
        </p>
      </div>

      <div className={styles.tear} aria-hidden="true" />

      <div className={styles.order}>
        <h3 className="visually-hidden">Ваш заказ</h3>
        <ul className={styles.items}>
          {lines.map((line) => (
            <li
              key={line.key}
              className={styles.item}
              style={line.accent ? ({ '--accent': line.accent } as CSSProperties) : undefined}
            >
              <div className={styles.itemText}>
                <p className={styles.itemTitle}>{line.title}</p>
                {line.subtitle && <p className={styles.itemSubtitle}>{line.subtitle}</p>}
              </div>
              <p className={styles.itemPrice}>{formatRub(line.totalKopecks)}</p>
              {line.onRemove && (
                <CloseButton
                  className={styles.itemRemove}
                  onPress={line.onRemove}
                  aria-label={`Убрать из заказа: ${line.title}`}
                />
              )}
            </li>
          ))}
        </ul>

        <dl className={styles.totals}>
          <div>
            <dt>Билетов</dt>
            <dd>{ticketCount}</dd>
          </div>
          <div>
            <dt>Бонусы за заказ</dt>
            <dd>
              <Link href="/account">после входа</Link>
            </dd>
          </div>
          <div className={styles.grandTotal}>
            <dt>Итого</dt>
            <dd>{formatRub(totalKopecks)}</dd>
          </div>
        </dl>

        <Button type="submit" form={formId} fullWidth className={styles.pay}>
          Перейти к оплате
        </Button>
        <p className={styles.afterPay}>Электронные билеты придут на почту после оплаты</p>
        {/* Живой регион есть всегда — сообщения появляются внутри (WCAG 4.1.3). */}
        <div role="status">{status}</div>
      </div>
    </aside>
  )
}
