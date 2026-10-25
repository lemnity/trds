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
import { usePathname, useSearchParams } from 'next/navigation'
import { useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'

import {
  formatPhoneInput,
  loginHrefFor,
  parseBonusRubles,
  parseContact,
  quoteOrder,
  selectionFromSearch,
  serviceFee,
  type ContactErrors,
  type PaymentMethod,
} from '@/modules/checkout'
import { quoteSeats } from '@/modules/seating'
import { formatRub } from '@/lib/money'
import { applyBonus } from '@/modules/loyalty'
import type { SalePerformance } from '@/modules/shows'

import { IS_STATIC_PREVIEW } from '../auth/session'
import { InlineNotice } from '../ui/InlineNotice'
import styles from './Checkout.module.css'
import { CheckoutBonus, useBonusAccount } from './CheckoutBonus'
import { CheckoutSummary, type OrderLine } from './CheckoutSummary'
import { newCheckoutKey, submitCheckout } from './checkout-api'

type Props = {
  performance: SalePerformance
  backHref: string
  fallbackUrl: string
}

const noopSubscribe = () => () => {}

const SECTION_LABELS = { left: 'левая сторона', center: 'центр', right: 'правая сторона' } as const

const icon = (path: string) => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
    <path
      d={path}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/**
 * Способы оплаты (референс заказчика). Банк не выбран (T-001), касса не подтверждена —
 * поэтому без логотипов платёжных систем и без обещаний в подписях.
 */
const PAYMENT_OPTIONS: Record<PaymentMethod, { title: string; caption: string; icon: ReactNode }> =
  {
    card: {
      title: 'Банковская карта',
      caption: 'Оплата картой на сайте',
      icon: icon('M3 6.5h18v11H3zM3 10h18M6.5 14.5h4'),
    },
    sbp: {
      title: 'СБП',
      caption: 'Через приложение вашего банка',
      icon: icon('M7.5 3h9v18h-9zM11 18h2M10 6.5h4'),
    },
    boxoffice: {
      title: 'В кассе театра',
      caption: 'Оплата лично в театре',
      icon: icon('M4 10l8-5 8 5M5.5 10v8M18.5 10v8M10 18v-4h4v4M3.5 18.5h17'),
    },
  }

type Order = { lines: OrderLine[]; count: number; total: number; seats: boolean }

/** Что видит зритель после нажатия «Оплатить». */
type Submission =
  | { state: 'idle' }
  | { state: 'sending' }
  /** Оплата на сайте не подключена (сервер ответил так или это превью без сервера). */
  | { state: 'unavailable'; boxoffice: boolean }
  | { state: 'error'; message: string }

/**
 * Оформление: выбор приходит из адреса, но суммы и доступность пересчитываются заново
 * по данным показа — параметрам ссылки не доверяем (rules.md §3).
 */
export function CheckoutView({ performance, backHref, fallbackUrl }: Props) {
  const params = useSearchParams()
  const pathname = usePathname()
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
  const [submission, setSubmission] = useState<Submission>({ state: 'idle' })
  // Ключ попытки живёт, пока не изменился заказ: повтор после сбоя — тот же заказ и платёж.
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null)
  const bonusAccount = useBonusAccount()
  const [bonusText, setBonusText] = useState('')
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
  // Суммы — только из applyBonus: введённое зрителем — лишь пожелание, его обрезает правило 30%
  // и баланс. При оплате на сервер уйдёт одно число — желаемое списание; сервер пересчитает всё.
  const bonusInput = parseBonusRubles(bonusText)
  const requestedBonus = bonusInput.ok ? bonusInput.kopecks : 0
  const bonus = applyBonus({
    ticketsKopecks: order.total,
    feeKopecks: fee,
    balanceKopecks: bonusAccount.status === 'ready' ? bonusAccount.balanceKopecks : 0,
    requestedKopecks: requestedBonus,
  })
  const signedIn = bonusAccount.status !== 'guest'

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
    if (!contact.ok || !selection || submission.state === 'sending') return
    // Превью без сервера и «оплата в кассе» (не подключена): ничего не бронируем и не
    // показываем «оплачено» (rules.md §7, §9).
    if (IS_STATIC_PREVIEW || contact.contact.payment === 'boxoffice') {
      setSubmission({ state: 'unavailable', boxoffice: contact.contact.payment === 'boxoffice' })
      return
    }
    // В запрос — только выбор, контакты и желаемое списание; суммы сервер считает сам.
    const request = {
      performanceId: performance.id,
      selection,
      contact: { ...contact.contact, consent: true as const, rulesAccepted: true as const },
      bonusKopecks: bonus.spentKopecks,
    }
    const fingerprint = JSON.stringify(request)
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: newCheckoutKey() }
    setSubmission({ state: 'sending' })
    void submitCheckout({ ...request, idempotencyKey: attempt.current.key }).then((outcome) => {
      if (outcome.kind === 'redirect') {
        // Страница банка (или результата). Факт оплаты сайт узнает от банка, не из адреса.
        window.location.assign(outcome.url)
        return
      }
      if (outcome.kind === 'unavailable')
        return setSubmission({ state: 'unavailable', boxoffice: false })
      // Ошибка, требующая нового заказа (бронь истекла, места заняты), — новый ключ.
      if (outcome.kind === 'error') attempt.current = null
      setSubmission({ state: 'error', message: outcome.message })
    })
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
          orientation="horizontal"
          className={styles.payment}
        >
          <Label className={styles.paymentLegend}>Оплата</Label>
          <div className={styles.tiles}>
            {(Object.keys(PAYMENT_OPTIONS) as PaymentMethod[]).map((method) => {
              const option = PAYMENT_OPTIONS[method]
              return (
                <Radio key={method} value={method} className={styles.tile}>
                  {/* Вся плитка — область нажатия Radio (RadioButton react-aria). */}
                  <Radio.Content className={styles.tileBody}>
                    <span className={styles.tileIcon}>{option.icon}</span>
                    <Label className={styles.tileText}>
                      <span className={styles.tileTitle}>{option.title}</span>
                      <span className={styles.tileCaption}>{option.caption}</span>
                    </Label>
                    <Radio.Control className={styles.tileControl}>
                      <Radio.Indicator />
                    </Radio.Control>
                  </Radio.Content>
                </Radio>
              )
            })}
          </div>
        </RadioGroup>

        <CheckoutBonus
          account={bonusAccount}
          loginHref={loginHrefFor(pathname, params.toString())}
          bonus={bonus}
          requestedKopecks={requestedBonus}
          value={bonusText}
          isInvalid={!bonusInput.ok}
          onChange={setBonusText}
        />

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

        <Button
          type="submit"
          fullWidth
          className={styles.pay}
          isPending={submission.state === 'sending'}
        >
          {submission.state === 'sending'
            ? 'Бронируем места…'
            : `Оплатить\u00a0 ${formatRub(bonus.cashKopecks)}`}
        </Button>

        {/* Живой регион есть всегда — сообщения появляются внутри (WCAG 4.1.3). */}
        <div role="status">
          {submission.state === 'unavailable' && (
            <div className={styles.notice}>
              <p className={styles.noticeTitle}>
                {submission.boxoffice
                  ? 'Бронь с оплатой в кассе пока не подключена'
                  : 'Оплата на сайте ещё не подключена'}
              </p>
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
          {submission.state === 'error' && (
            <div className={styles.notice}>
              <p className={styles.noticeTitle}>Заказ не оформлен</p>
              <p>{submission.message}</p>
            </div>
          )}
        </div>
      </form>

      <CheckoutSummary
        heading={order.seats ? 'Ваши места' : 'Ваши билеты'}
        lines={order.lines}
        ticketCount={order.count}
        feeKopecks={fee}
        bonusKopecks={bonus.spentKopecks}
        accrualKopecks={signedIn ? bonus.accrualKopecks : null}
        totalKopecks={bonus.cashKopecks}
      />
    </div>
  )
}
