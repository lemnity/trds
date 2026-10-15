'use client'

import {
  Button,
  Checkbox,
  FieldError,
  Input,
  Label,
  Radio,
  RadioGroup,
  TextField,
} from '@heroui/react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react'

import {
  formatPhoneInput,
  parseContact,
  quoteOrder,
  selectionFromSearch,
  serviceFee,
  type ContactErrors,
  type PaymentMethod,
} from '@/modules/checkout'
import { quoteSeats } from '@/modules/seating'
import { formatRub } from '@/lib/money'
import type { SalePerformance } from '@/modules/shows'

import { InlineNotice } from '../ui/InlineNotice'
import styles from './Checkout.module.css'
import { CheckoutSummary, type OrderLine } from './CheckoutSummary'

type Props = {
  performance: SalePerformance
  backHref: string
  fallbackUrl: string
}

const noopSubscribe = () => () => {}

const SECTION_LABELS = { left: 'левая сторона', center: 'центр', right: 'правая сторона' } as const

/** Способы оплаты из референса заказчика; банк ещё не подключён (T-001), касса не подтверждена. */
const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  card: 'Банковская карта',
  sbp: 'СБП',
  boxoffice: 'В кассе театра',
}

type Order = { lines: OrderLine[]; count: number; total: number; seats: boolean }

/**
 * Оформление: выбор приходит из адреса, но суммы и доступность пересчитываются заново
 * по данным показа — параметрам ссылки не доверяем (rules.md §3).
 */
export function CheckoutView({ performance, backHref, fallbackUrl }: Props) {
  const params = useSearchParams()
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const consentRef = useRef<HTMLDivElement>(null)
  const rulesRef = useRef<HTMLDivElement>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [payment, setPayment] = useState<PaymentMethod>('card')
  const [rulesAccepted, setRulesAccepted] = useState(false)
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<ContactErrors>({})
  const [paymentUnavailable, setPaymentUnavailable] = useState(false)
  const started = useSyncExternalStore(
    noopSubscribe,
    () => Date.parse(performance.startsAt) <= Date.now(),
    () => false,
  )

  const selection = selectionFromSearch(params)

  let order: Order | null = null
  if (selection?.kind === 'tickets' && !performance.seating) {
    const quote = quoteOrder(performance.ticketTypes, selection.quantities)
    if (quote.ok)
      order = {
        lines: quote.quote.lines.map((l) => ({
          key: l.ticketTypeId,
          title: `${l.title} × ${l.quantity}`,
          totalKopecks: l.totalKopecks,
        })),
        count: quote.quote.ticketCount,
        total: quote.quote.totalKopecks,
        seats: false,
      }
  }
  if (selection?.kind === 'seats' && performance.seating) {
    const { plan, pricesKopecks, unavailableSeatIds } = performance.seating
    const categoryTitle = new Map(plan.categories.map((c) => [c.id, c.title]))
    const quote = quoteSeats(plan, pricesKopecks, new Set(unavailableSeatIds), selection.seatIds)
    if (quote.ok)
      order = {
        lines: quote.quote.seats.map((s) => ({
          key: s.id,
          title: `${categoryTitle.get(s.categoryId)} · ${SECTION_LABELS[s.section]}, р.${s.row} м.${s.number}`,
          totalKopecks: s.priceKopecks,
        })),
        count: quote.quote.ticketCount,
        total: quote.quote.totalKopecks,
        seats: true,
      }
  }

  if (started) {
    return (
      <InlineNotice tone="info" title="Показ уже начался">
        <p>
          Продажа на этот показ закрыта. <Link href="/afisha">Выберите другую дату в афише</Link>.
        </p>
      </InlineNotice>
    )
  }

  if (!order) {
    return (
      <InlineNotice tone="warning" title="Не удалось восстановить выбор">
        <p>
          Ссылка неполная, или выбранные места уже недоступны.{' '}
          <Link href={backHref}>Вернуться к выбору билетов</Link>.
        </p>
      </InlineNotice>
    )
  }

  const fee = serviceFee(order.count)
  const toPay = order.total + fee

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const contact = parseContact({ name, email, phone, payment, rulesAccepted, consent })
    const nextErrors = contact.ok ? {} : contact.errors
    setErrors(nextErrors)
    // Фокус — на первое поле с ошибкой, в порядке формы.
    if (nextErrors.name) return nameRef.current?.focus()
    if (nextErrors.email) return emailRef.current?.focus()
    if (nextErrors.phone) return phoneRef.current?.focus()
    if (nextErrors.rulesAccepted) return rulesRef.current?.querySelector('input')?.focus()
    if (nextErrors.consent) return consentRef.current?.querySelector('input')?.focus()
    // Банк и параметры чека ещё не подтверждены (T-001/T-002): платёж не создаём,
    // ничего не бронируем и не показываем «оплачено» (rules.md §7, §9).
    setPaymentUnavailable(true)
  }

  return (
    <div className={styles.layout}>
      <form className={styles.form} onSubmit={submit} noValidate aria-label="Данные покупателя">
        <TextField
          autoComplete="name"
          value={name}
          onChange={setName}
          isInvalid={Boolean(errors.name)}
          validationBehavior="aria"
          className={styles.field}
        >
          <Label>Имя и фамилия</Label>
          <Input ref={nameRef} placeholder="Степан Верховенский" />
          <FieldError>{errors.name}</FieldError>
        </TextField>

        <div className={styles.row}>
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
            <Label>E-mail</Label>
            <Input ref={emailRef} placeholder="you@theatre.ru" />
            <FieldError>{errors.email}</FieldError>
          </TextField>
          <TextField
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(value) => setPhone(formatPhoneInput(value))}
            isInvalid={Boolean(errors.phone)}
            validationBehavior="aria"
            className={styles.field}
          >
            <Label>Телефон</Label>
            <Input ref={phoneRef} placeholder="+7 ___ ___-__-__" />
            <FieldError>{errors.phone}</FieldError>
          </TextField>
        </div>

        <RadioGroup
          value={payment}
          onChange={(value) => setPayment(value as PaymentMethod)}
          className={styles.payment}
        >
          <Label className={styles.paymentLegend}>Оплата</Label>
          {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((method) => (
            <Radio key={method} value={method} className={styles.radio}>
              <Radio.Content>
                <Radio.Control>
                  <Radio.Indicator />
                </Radio.Control>
                <Label>{PAYMENT_LABELS[method]}</Label>
              </Radio.Content>
            </Radio>
          ))}
        </RadioGroup>

        <Checkbox
          ref={rulesRef}
          isSelected={rulesAccepted}
          onChange={setRulesAccepted}
          isRequired
          isInvalid={Boolean(errors.rulesAccepted)}
          validationBehavior="aria"
          className={styles.check}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Label>Согласен с правилами продажи и возврата билетов</Label>
          </Checkbox.Content>
          <FieldError>{errors.rulesAccepted}</FieldError>
        </Checkbox>
        {/* Согласие на ПД — отдельное от правил продажи (152-ФЗ), не объединяем. */}
        <Checkbox
          ref={consentRef}
          isSelected={consent}
          onChange={setConsent}
          isRequired
          isInvalid={Boolean(errors.consent)}
          validationBehavior="aria"
          className={styles.check}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Label>Согласен на обработку персональных данных для оформления билетов</Label>
          </Checkbox.Content>
          <FieldError>{errors.consent}</FieldError>
        </Checkbox>

        <Button type="submit" fullWidth className={styles.pay}>
          Оплатить&nbsp; {formatRub(toPay)}
        </Button>

        {/* Живой регион есть всегда — сообщения появляются внутри (WCAG 4.1.3). */}
        <div role="status">
          {paymentUnavailable && (
            <div className={styles.notice}>
              <p className={styles.noticeTitle}>Оплата на сайте ещё не подключена</p>
              <p>
                Мы подключаем банк театра. Места не забронированы, деньги не списаны. Купить билет
                сейчас можно на{' '}
                <a href={fallbackUrl} rel="noopener">
                  текущем сайте театра
                </a>
                .
              </p>
            </div>
          )}
        </div>
      </form>

      <CheckoutSummary
        heading={order.seats ? 'Ваши места' : 'Ваши билеты'}
        lines={order.lines}
        ticketCount={order.count}
        feeKopecks={fee}
        totalKopecks={toPay}
      />
    </div>
  )
}
