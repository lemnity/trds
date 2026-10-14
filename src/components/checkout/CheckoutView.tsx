'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState, useSyncExternalStore } from 'react'

import { quoteOrder, selectionFromSearch } from '@/modules/checkout'
import { quoteSeats } from '@/modules/seating'
import { formatPerformanceDate, type SalePerformance } from '@/modules/shows'

import { OrderPanel, type OrderLine } from '../show/OrderPanel'
import { InlineNotice } from '../ui/InlineNotice'

type Props = {
  performance: SalePerformance
  fallbackUrl: string
}

const noopSubscribe = () => () => {}

type Order = { lines: OrderLine[]; count: number; total: number }

/**
 * Оформление: выбор приходит из адреса, но суммы и доступность пересчитываются заново
 * по данным показа — параметрам ссылки не доверяем (rules.md §3).
 */
export function CheckoutView({ performance, fallbackUrl }: Props) {
  const params = useSearchParams()
  const [paymentUnavailable, setPaymentUnavailable] = useState(false)
  const started = useSyncExternalStore(
    noopSubscribe,
    () => Date.parse(performance.startsAt) <= Date.now(),
    () => false,
  )

  const date = formatPerformanceDate(performance.startsAt)
  const backHref = `/shows/${performance.show.slug}?date=${performance.id}#tickets`
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
      }
  }
  if (selection?.kind === 'seats' && performance.seating) {
    const { plan, pricesKopecks, unavailableSeatIds } = performance.seating
    const quote = quoteSeats(plan, pricesKopecks, new Set(unavailableSeatIds), selection.seatIds)
    if (quote.ok)
      order = {
        lines: quote.quote.seats.map((s) => ({
          key: s.id,
          title: `Ряд ${s.row}, место ${s.number}`,
          totalKopecks: s.priceKopecks,
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

  return (
    <div>
      <p>
        <Link href={backHref}>← Изменить выбор</Link>
      </p>
      <OrderPanel
        heading={`${performance.show.title} · ${date.longDate} ${date.time}`}
        lines={order.lines}
        ticketCount={order.count}
        totalKopecks={order.total}
        emptyText=""
        selectionError={null}
        paymentUnavailable={paymentUnavailable}
        fallbackUrl={fallbackUrl}
        // Банк и параметры чека ещё не подтверждены (T-001/T-002): платёж не создаём,
        // ничего не бронируем и не показываем «оплачено» (rules.md §7, §9).
        onConfirm={() => setPaymentUnavailable(true)}
      />
    </div>
  )
}
