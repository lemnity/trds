'use client'

import { Checkbox, Description, FieldError, Input, Label, TextField } from '@heroui/react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react'

import {
  parseContact,
  quoteOrder,
  selectionFromSearch,
  selectionToSearch,
  type ContactErrors,
  type Selection,
} from '@/modules/checkout'
import { quoteSeats } from '@/modules/seating'
import { formatRub } from '@/lib/money'
import type { SalePerformance } from '@/modules/shows'

import { SEAT_CATEGORY_COLORS } from '../show/SeatMap'
import { InlineNotice } from '../ui/InlineNotice'
import { cardClass } from '../ui/card'
import { BonusReminder } from './BonusReminder'
import styles from './Checkout.module.css'
import { CheckoutSummary, type OrderLine } from './CheckoutSummary'

type Props = {
  performance: SalePerformance
  backHref: string
  fallbackUrl: string
}

const noopSubscribe = () => () => {}

const SECTION_LABELS = { left: 'левая сторона', center: 'центр', right: 'правая сторона' } as const

const FORM_ID = 'checkout-contact'

type Order = { lines: OrderLine[]; count: number; total: number }

/**
 * Оформление: выбор приходит из адреса, но суммы и доступность пересчитываются заново
 * по данным показа — параметрам ссылки не доверяем (rules.md §3).
 */
export function CheckoutView({ performance, backHref, fallbackUrl }: Props) {
  const params = useSearchParams()
  const router = useRouter()
  const emailRef = useRef<HTMLInputElement>(null)
  const consentRef = useRef<HTMLDivElement>(null)
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<ContactErrors>({})
  const [paymentUnavailable, setPaymentUnavailable] = useState(false)
  const started = useSyncExternalStore(
    noopSubscribe,
    () => Date.parse(performance.startsAt) <= Date.now(),
    () => false,
  )

  const selection = selectionFromSearch(params)

  // Удаление позиции меняет выбор в адресе; пустой заказ — назад к выбору мест.
  const update = (next: Selection, isEmpty: boolean) => {
    setPaymentUnavailable(false)
    if (isEmpty) router.push(backHref)
    else router.replace(`?${selectionToSearch(next)}`, { scroll: false })
  }

  let order: Order | null = null
  if (selection?.kind === 'tickets' && !performance.seating) {
    const quote = quoteOrder(performance.ticketTypes, selection.quantities)
    if (quote.ok)
      order = {
        lines: quote.quote.lines.map((l) => ({
          key: l.ticketTypeId,
          title: l.title,
          subtitle: `${l.quantity} × ${formatRub(l.unitPriceKopecks)}`,
          totalKopecks: l.totalKopecks,
          onRemove: () => {
            const rest = Object.fromEntries(
              Object.entries(selection.quantities).filter(([id]) => id !== l.ticketTypeId),
            )
            update({ kind: 'tickets', quantities: rest }, Object.keys(rest).length === 0)
          },
        })),
        count: quote.quote.ticketCount,
        total: quote.quote.totalKopecks,
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
          title: `Ряд ${s.row}, место ${s.number}`,
          subtitle: `${categoryTitle.get(s.categoryId)} · ${SECTION_LABELS[s.section]}`,
          accent: SEAT_CATEGORY_COLORS[s.categoryId],
          totalKopecks: s.priceKopecks,
          onRemove: () => {
            const rest = selection.seatIds.filter((id) => id !== s.id)
            update({ kind: 'seats', seatIds: rest }, rest.length === 0)
          },
        })),
        count: quote.quote.ticketCount,
        total: quote.quote.totalKopecks,
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

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const contact = parseContact({ email, consent })
    const nextErrors = contact.ok ? {} : contact.errors
    setErrors(nextErrors)
    if (nextErrors.email) return emailRef.current?.focus()
    if (nextErrors.consent) return consentRef.current?.querySelector('input')?.focus()
    // Банк и параметры чека ещё не подтверждены (T-001/T-002): платёж не создаём,
    // ничего не бронируем и не показываем «оплачено» (rules.md §7, §9).
    setPaymentUnavailable(true)
  }

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <BonusReminder />

        <form
          id={FORM_ID}
          className={cardClass(styles.section)}
          onSubmit={submit}
          noValidate
          aria-labelledby={`${FORM_ID}-title`}
        >
          <h2 id={`${FORM_ID}-title`} className={styles.sectionTitle}>
            Куда прислать билеты
          </h2>
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
            <Input ref={emailRef} placeholder="name@example.ru" />
            <Description>На этот адрес придут электронные билеты</Description>
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
        </form>
      </div>

      <CheckoutSummary
        performance={performance}
        lines={order.lines}
        ticketCount={order.count}
        totalKopecks={order.total}
        formId={FORM_ID}
        status={
          paymentUnavailable && (
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
          )
        }
      />
    </div>
  )
}
