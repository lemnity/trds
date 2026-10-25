'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { formatRub } from '@/lib/money'

import { IS_STATIC_PREVIEW } from '../auth/session'
import { InlineNotice } from '../ui/InlineNotice'
import { fetchOrderStatus, type OrderStatusResponse } from './checkout-api'

const POLL_MS = 3_000
/** Сколько ждать подтверждения банка на странице, прежде чем предложить зайти позже. */
const POLL_LIMIT = 60

type View =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'error' }
  | { state: 'ready'; order: OrderStatusResponse; waitedOut: boolean }

/**
 * Страница после банка (T-044). Статус — только с сервера (`GET /api/checkout/orders/<id>`),
 * адрес возврата лишь называет заказ: «оплачено» по параметрам адреса не показываем (rules.md §4,
 * §7). Пока заказ ждёт оплату, страница опрашивает сервер; сервер сам сверяется с банком.
 */
export function CheckoutResult() {
  const params = useSearchParams()
  const orderId = params.get('order') ?? ''
  const token = params.get('token') ?? ''
  const valid = !IS_STATIC_PREVIEW && /^[0-9a-f-]{36}$/.test(orderId) && token.length > 0
  const [view, setView] = useState<View>({ state: 'loading' })

  useEffect(() => {
    if (!valid) return
    let cancelled = false
    let timer: number | undefined
    let polls = 0
    const load = async () => {
      const result = await fetchOrderStatus(orderId, token)
      if (cancelled) return
      polls++
      if (result === null) return setView({ state: 'missing' })
      if (result === 'error') {
        setView((current) => (current.state === 'ready' ? current : { state: 'error' }))
      } else {
        const waitedOut = result.status === 'pending' && polls >= POLL_LIMIT
        setView({ state: 'ready', order: result, waitedOut })
        if (result.status !== 'pending' || waitedOut) return
      }
      if (polls < POLL_LIMIT) timer = window.setTimeout(() => void load(), POLL_MS)
    }
    void load()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [valid, orderId, token])

  if (!valid || view.state === 'missing')
    return (
      <InlineNotice tone="warning" title="Заказ не найден">
        <p>
          Ссылка неполная или устарела. Если оплата прошла, билеты придут на почту.{' '}
          <Link href="/afisha">Перейти в афишу</Link>.
        </p>
      </InlineNotice>
    )
  if (view.state === 'loading')
    return (
      <InlineNotice tone="info" title="Проверяем заказ…">
        <p>Это займёт несколько секунд.</p>
      </InlineNotice>
    )
  if (view.state === 'error')
    return (
      <InlineNotice tone="warning" title="Не удалось получить статус">
        <p>Сервер не ответил. Обновите страницу через минуту — заказ при этом не потеряется.</p>
      </InlineNotice>
    )

  const { order, waitedOut } = view
  const number = `Заказ ${order.orderNumber}`
  const amount = formatRub(order.amountKopecks)
  switch (order.status) {
    case 'paid':
      return (
        <InlineNotice tone="info" title="Оплата подтверждена">
          <p>
            {number} оплачен: {amount}. Билеты отправим на почту, они появятся в разделе{' '}
            <Link href="/account#tickets">«Мои билеты»</Link>.
          </p>
        </InlineNotice>
      )
    case 'pending':
      return (
        <InlineNotice
          tone="info"
          title={waitedOut ? 'Банк ещё не подтвердил оплату' : 'Ждём подтверждения банка…'}
        >
          <p>
            {number} на {amount}.{' '}
            {waitedOut
              ? 'Если деньги списаны, заказ подтвердится автоматически и билеты придут на почту. Обновите страницу позже.'
              : 'Обычно это несколько секунд. Не закрывайте страницу.'}
          </p>
        </InlineNotice>
      )
    case 'failed':
      return (
        <InlineNotice tone="warning" title="Оплата не прошла">
          <p>
            {number}: банк отклонил платёж, деньги не списаны. Бронь снята, списанные бонусы
            вернутся на счёт. <Link href="/afisha">Выбрать билеты заново</Link>.
          </p>
        </InlineNotice>
      )
    case 'expired':
      return (
        <InlineNotice tone="warning" title="Время брони истекло">
          <p>
            {number}: оплата не поступила вовремя, места освобождены. Если банк всё же спишет
            деньги, заказ подтвердится автоматически или деньги вернутся.{' '}
            <Link href="/afisha">Выбрать билеты заново</Link>.
          </p>
        </InlineNotice>
      )
    case 'review':
      return (
        <InlineNotice tone="warning" title="Оплата получена, заказ проверяем">
          <p>
            {number}: деньги поступили, но выдать билеты автоматически не получилось. Касса театра
            свяжется с вами по почте и выдаст билеты или вернёт деньги.
          </p>
        </InlineNotice>
      )
    case 'refunded':
      return (
        <InlineNotice tone="info" title="Заказ возвращён">
          <p>{number}: деньги возвращены.</p>
        </InlineNotice>
      )
  }
}
