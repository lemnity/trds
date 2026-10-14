'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useSyncExternalStore } from 'react'

import {
  quoteOrder,
  selectionFromSearch,
  selectionToSearch,
  type Selection,
} from '@/modules/checkout'
import { quoteSeats } from '@/modules/seating'
import { formatRub } from '@/lib/money'
import { formatPerformanceDate, type SalePerformance } from '@/modules/shows'

import { OrderPanel, type OrderLine } from '../show/OrderPanel'
import { SEAT_CATEGORY_COLORS } from '../show/SeatMap'
import { InlineNotice } from '../ui/InlineNotice'

type Props = {
  performance: SalePerformance
  fallbackUrl: string
}

const noopSubscribe = () => () => {}

const SECTION_LABELS = { left: 'левая сторона', center: 'центр', right: 'правая сторона' } as const

type Order = { lines: OrderLine[]; count: number; total: number }

/**
 * Оформление: выбор приходит из адреса, но суммы и доступность пересчитываются заново
 * по данным показа — параметрам ссылки не доверяем (rules.md §3).
 */
export function CheckoutView({ performance, fallbackUrl }: Props) {
  const params = useSearchParams()
  const router = useRouter()
  const [paymentUnavailable, setPaymentUnavailable] = useState(false)
  const started = useSyncExternalStore(
    noopSubscribe,
    () => Date.parse(performance.startsAt) <= Date.now(),
    () => false,
  )

  const date = formatPerformanceDate(performance.startsAt)
  const backHref = `/shows/${performance.show.slug}?date=${performance.id}#tickets`
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
