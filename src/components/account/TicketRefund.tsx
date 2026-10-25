'use client'

import { buttonVariants } from '@heroui/styles'
import { useState } from 'react'
import { Button } from 'react-aria-components'

import { formatRub } from '@/lib/money'
import type { CustomerRefundBlock } from '@/modules/refunds'

import { postJson } from '../auth/api'
import styles from './Tickets.module.css'
import { formatTicketDate } from './tickets-view'
import { reloadTickets } from './useAccountTickets'

/**
 * Возврат билета из кабинета (T-052, PRD §5.4). Решает только сервер: предпросмотр
 * (`GET /api/account/refunds`) показывает сумму и последствия до подтверждения (rules.md §7),
 * подтверждение — `POST` с ключом попытки (двойной клик не вернёт деньги дважды). Пока банк не
 * подтвердил, статус — «обрабатывается», а не «возвращено» (PAY-06). Если правила театра не
 * позволяют вернуть в кабинете (по умолчанию — пока театр не утвердил правила), честно пишем,
 * что возврат — через кассу театра или по почте.
 */

type Quote = {
  orderNumber: string
  ticketNumbers: string[]
  otherRefundable: string[]
  amounts: { cashKopecks: number; bonusKopecks: number; feeKopecks: number }
  feeKeptKopecks: number
  block: CustomerRefundBlock | null
  deadline: string | null
  pending: RefundView | null
}

type RefundView = {
  id: string
  status: 'processing' | 'succeeded' | 'failed'
  cashKopecks: number
  bonusKopecks: number
  ticketNumbers: string[]
}

type State =
  | { step: 'idle' }
  | { step: 'loading' }
  | { step: 'quote'; quote: Quote; key: string }
  | { step: 'sending'; quote: Quote; key: string }
  | { step: 'done'; refund: RefundView }
  | { step: 'error'; message: string }

const OFFLINE =
  'Вернуть билет можно через кассу театра или по почте — напишите нам, указав номер заказа.'

export const BLOCK_TEXT: Record<CustomerRefundBlock, string> = {
  DISABLED: `Возврат в личном кабинете пока не работает. ${OFFLINE}`,
  DEADLINE_PASSED: `Срок возврата в кабинете прошёл. ${OFFLINE}`,
  SHOW_TIME_UNKNOWN: `Не удалось проверить время показа. ${OFFLINE}`,
  NOT_REFUNDABLE: 'Этот билет вернуть нельзя: он уже возвращается или недействителен.',
  PARTIAL_NOT_ALLOWED: 'По правилам театра заказ возвращается только целиком.',
}

const STATUS_TEXT: Record<RefundView['status'], string> = {
  processing:
    'Возврат обрабатывается: банк ещё не подтвердил операцию. Мы пришлём письмо, когда деньги будут возвращены.',
  succeeded:
    'Банк подтвердил возврат. Деньги поступят на карту, с которой оплачен заказ; срок зачисления зависит от вашего банка.',
  failed: `Банк отклонил возврат, билет снова действует. ${OFFLINE}`,
}

const ERROR_TEXT: Record<string, string> = {
  in_progress: 'Возврат по этому билету уже обрабатывается.',
  not_refundable: 'Этот билет вернуть нельзя.',
  payment_unavailable: `Возврат на сайте сейчас недоступен. ${OFFLINE}`,
  too_many: 'Слишком много попыток. Подождите несколько минут.',
  unauthorized: 'Войдите в личный кабинет заново.',
}

const newKey = () => crypto.randomUUID()

export function TicketRefund({ ticketNumber }: { ticketNumber: string }) {
  const [state, setState] = useState<State>({ step: 'idle' })

  const load = async () => {
    setState({ step: 'loading' })
    try {
      const res = await fetch(`/api/account/refunds?tickets=${encodeURIComponent(ticketNumber)}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error(String(res.status))
      setState({ step: 'quote', quote: (await res.json()) as Quote, key: newKey() })
    } catch {
      setState({ step: 'error', message: 'Не удалось проверить возврат. Повторите позже.' })
    }
  }

  const confirm = async (quote: Quote, key: string) => {
    setState({ step: 'sending', quote, key })
    const { status, data } = await postJson<{
      refund?: RefundView
      error?: string
      block?: CustomerRefundBlock
    }>('/api/account/refunds', { tickets: quote.ticketNumbers, clientKey: key })
    if (data?.refund) {
      setState({ step: 'done', refund: data.refund })
      void reloadTickets()
      return
    }
    const message =
      (data?.block && BLOCK_TEXT[data.block]) ||
      (data?.error && ERROR_TEXT[data.error]) ||
      (status === 0
        ? 'Нет связи. Проверьте интернет и повторите.'
        : 'Возврат не оформлен. Повторите позже.')
    setState({ step: 'error', message })
  }

  if (state.step === 'idle')
    return (
      <Button className={buttonVariants({ variant: 'outline' })} onPress={load}>
        Вернуть билет
      </Button>
    )
  if (state.step === 'loading')
    return (
      <p className={styles.refund} role="status">
        Проверяем, можно ли вернуть билет…
      </p>
    )
  if (state.step === 'error')
    return (
      <div className={styles.refund} role="alert">
        <p>{state.message}</p>
      </div>
    )
  if (state.step === 'done')
    return (
      <div className={styles.refund} role="status">
        <p className={styles.refundTitle}>
          {state.refund.status === 'succeeded' ? 'Возврат выполнен' : 'Возврат оформлен'}
        </p>
        <p>{STATUS_TEXT[state.refund.status]}</p>
      </div>
    )

  const { quote } = state
  if (quote.pending)
    return (
      <div className={styles.refund} role="status">
        <p>{STATUS_TEXT[quote.pending.status]}</p>
      </div>
    )
  if (quote.block)
    return (
      <div className={styles.refund} role="status">
        <p>{BLOCK_TEXT[quote.block]}</p>
      </div>
    )
  const until = quote.deadline ? formatTicketDate(quote.deadline) : null
  const several = quote.ticketNumbers.length > 1
  return (
    <section className={styles.refund} aria-label="Возврат билета">
      <p className={styles.refundTitle}>
        {several ? `Вернуть билеты: ${quote.ticketNumbers.join(', ')}` : 'Вернуть билет'}
      </p>
      <dl className={styles.orderSum}>
        <div>
          <dt>Вернётся на карту</dt>
          <dd>{formatRub(quote.amounts.cashKopecks)}</dd>
        </div>
        {quote.amounts.bonusKopecks > 0 && (
          <div>
            <dt>Вернётся бонусами</dt>
            <dd>{formatRub(quote.amounts.bonusKopecks)}</dd>
          </div>
        )}
        {quote.feeKeptKopecks > 0 && (
          <div>
            <dt>Сервисный сбор не возвращается</dt>
            <dd>{formatRub(quote.feeKeptKopecks)}</dd>
          </div>
        )}
      </dl>
      <p className={styles.refundNote}>
        После возврата {several ? 'билеты перестанут' : 'билет перестанет'} действовать. Бонусы,
        начисленные за {several ? 'эти билеты' : 'этот билет'}, будут списаны.
        {until &&
          ` Вернуть в кабинете можно до ${until.date}${until.time ? `, ${until.time}` : ''}.`}
      </p>
      <Button
        className={buttonVariants({ variant: 'danger' })}
        isDisabled={state.step === 'sending'}
        onPress={() => confirm(quote, state.key)}
      >
        {state.step === 'sending'
          ? 'Оформляем возврат…'
          : `Подтвердить возврат ${formatRub(quote.amounts.cashKopecks)}`}
      </Button>
      <Button
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        isDisabled={state.step === 'sending'}
        onPress={() => setState({ step: 'idle' })}
      >
        Отмена
      </Button>
    </section>
  )
}
