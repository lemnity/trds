'use client'

import { useId, useRef, useState, type FormEvent } from 'react'

import { formatRub } from '@/lib/money'
import { parseContact, type ContactErrors } from '@/modules/checkout'

import styles from './ShowBooking.module.css'
import { Button, Checkbox, CloseButton, FieldError, Input, Label, TextField } from '@heroui/react'
import { cardClass } from '../ui/card'

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
  heading: string
  lines: OrderLine[]
  ticketCount: number
  totalKopecks: number
  emptyText: string
  selectionError: string | null
  paymentUnavailable: boolean
  fallbackUrl: string
  /** Контакт прошёл проверку — родитель проверяет выбор и решает, что показать. */
  onConfirm: () => void
}

export function OrderPanel(props: Props) {
  const ids = useId()
  const emailRef = useRef<HTMLInputElement>(null)
  const consentRef = useRef<HTMLDivElement>(null)
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<ContactErrors>({})

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const contact = parseContact({ email, consent })
    const nextErrors = contact.ok ? {} : contact.errors
    setErrors(nextErrors)
    if (nextErrors.email) return emailRef.current?.focus()
    if (nextErrors.consent) return consentRef.current?.querySelector('input')?.focus()
    props.onConfirm()
  }

  return (
    <form
      className={cardClass(`${styles.card} ${styles.summary}`)}
      onSubmit={submit}
      noValidate
      aria-labelledby={`${ids}-order`}
    >
      <h3 id={`${ids}-order`} className={styles.cardTitle}>
        Ваш заказ
      </h3>
      <p className={styles.orderFor}>{props.heading}</p>
      {props.lines.length > 0 ? (
        <ul className={styles.items}>
          {props.lines.map((line) => (
            <li
              key={line.key}
              className={styles.item}
              style={line.accent ? ({ '--accent': line.accent } as React.CSSProperties) : undefined}
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
      ) : (
        <p className={styles.emptyOrder}>{props.emptyText}</p>
      )}
      <dl className={styles.totals}>
        <div>
          <dt>Билетов</dt>
          <dd>{props.ticketCount}</dd>
        </div>
      </dl>
      <dl className={styles.grandTotal}>
        <div>
          <dt>Итого</dt>
          <dd>{formatRub(props.totalKopecks)}</dd>
        </div>
      </dl>

      <TextField
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={setEmail}
        isRequired
        isInvalid={Boolean(errors.email)}
        validationBehavior="aria"
        className={styles.field}
      >
        {/* Обязательность HeroUI показывает звёздочкой, у поля — aria-required. */}
        <Label>Электронная почта</Label>
        <Input ref={emailRef} className={styles.input} />
        <FieldError>{errors.email}</FieldError>
      </TextField>
      <Checkbox
        ref={consentRef}
        isSelected={consent}
        onChange={setConsent}
        isRequired
        isInvalid={Boolean(errors.consent)}
        validationBehavior="aria"
        className={styles.consent}
      >
        <Checkbox.Content>
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Label>Согласен на обработку персональных данных для оформления билетов</Label>
        </Checkbox.Content>
        <FieldError>{errors.consent}</FieldError>
      </Checkbox>

      <Button type="submit" fullWidth className={styles.submit}>
        Оформить заказ
      </Button>
      <p className={styles.afterSubmit}>Электронные билеты придут на почту после оплаты</p>

      {/* Живой регион есть всегда — сообщения появляются внутри (WCAG 4.1.3). */}
      <div role="status">
        {props.selectionError && <p className={styles.error}>{props.selectionError}</p>}
        {props.paymentUnavailable && (
          <div className={styles.notice}>
            <p className={styles.noticeTitle}>Оплата на сайте ещё не подключена</p>
            <p>
              Мы подключаем банк театра. Места не забронированы, деньги не списаны. Купить билет
              сейчас можно на{' '}
              <a href={props.fallbackUrl} rel="noopener">
                текущем сайте театра
              </a>
              .
            </p>
          </div>
        )}
      </div>
    </form>
  )
}
