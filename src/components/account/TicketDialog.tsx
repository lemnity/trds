'use client'

import { buttonVariants } from '@heroui/styles'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'

import { formatRub } from '@/lib/money'

import styles from './Tickets.module.css'
import { downloadIcs, ticketIcs } from './ticket-calendar'
import { TicketRefund } from './TicketRefund'
import {
  TICKET_STATE_HINTS,
  TICKET_STATE_LABELS,
  canAddToCalendar,
  formatTicketDate,
  mapUrl,
  orderStatusLabel,
  ticketPlace,
  type OrderView,
  type TicketView,
} from './tickets-view'

const siteOrigin = () => `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}`

/**
 * Билет крупно (design.md §6 `TicketQrDialog`): QR на весь экран телефона на белом фоне, спектакль,
 * время с поясом, площадка с адресом, «В календарь» и состав заказа. Диалог react-aria: фокус
 * внутри, Escape закрывает, фокус возвращается на кнопку открытия.
 */
export function TicketDialog({
  ticket,
  order,
  isOpen,
  onOpenChange,
  demo,
}: {
  ticket: TicketView
  order: OrderView | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  demo: boolean
}) {
  const { date, time } = formatTicketDate(ticket.startsAt)
  const now = new Date()
  const hint = TICKET_STATE_HINTS[ticket.state]

  const addToCalendar = () => {
    const ics = ticketIcs(ticket, { now: new Date(), siteUrl: siteOrigin() })
    if (ics) downloadIcs(`turdus-${ticket.number}.ics`, ics)
  }

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className={styles.overlay}
    >
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog} aria-label={`Билет ${ticket.number}`}>
          {({ close }) => (
            <>
              <div className={styles.dialogHead}>
                <Heading slot="title" className={styles.dialogTitle}>
                  {ticket.show?.title ?? 'Спектакль'}
                </Heading>
                <Button
                  className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                  onPress={close}
                >
                  Закрыть
                </Button>
              </div>

              {ticket.qrUrl ? (
                <figure className={styles.qrBox}>
                  {/* Картинка с сервера (сессия владельца) или демо-QR; не next/image — без оптимизации и кеша. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ticket.qrUrl}
                    alt={`QR-код билета ${ticket.number}`}
                    className={styles.qr}
                    width={320}
                    height={320}
                  />
                  <figcaption className={styles.qrCaption}>
                    {demo
                      ? 'Демо: этот QR не билет.'
                      : 'Покажите код на входе. Увеличьте яркость экрана.'}
                  </figcaption>
                </figure>
              ) : (
                <p className={styles.qrMissing} role="status">
                  {ticket.state === 'valid'
                    ? 'Показ уже прошёл — QR-код больше не нужен.'
                    : `${TICKET_STATE_LABELS[ticket.state]}. ${hint ?? ''}`}
                </p>
              )}

              <dl className={styles.facts}>
                <div>
                  <dt>Когда</dt>
                  <dd>
                    {date}
                    {time && `, ${time}`}
                  </dd>
                </div>
                {ticket.venue && (
                  <div>
                    <dt>Где</dt>
                    <dd>
                      {ticket.venue.title}
                      <br />
                      <a href={mapUrl(ticket.venue.address)} target="_blank" rel="noreferrer">
                        {ticket.venue.address}
                      </a>
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Место</dt>
                  <dd>{ticketPlace(ticket)}</dd>
                </div>
                <div>
                  <dt>Билет</dt>
                  <dd>
                    {ticket.number} · {TICKET_STATE_LABELS[ticket.state]}
                  </dd>
                </div>
              </dl>

              {canAddToCalendar(ticket, now) && (
                <Button className={buttonVariants({ variant: 'outline' })} onPress={addToCalendar}>
                  Добавить в календарь
                </Button>
              )}

              {order && <OrderDetails order={order} />}

              {/* Возврат — только у действующего билета на будущий показ; правила проверит сервер. */}
              {!demo && ticket.state === 'valid' && ticket.qrUrl && (
                <TicketRefund ticketNumber={ticket.number} />
              )}
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}

function OrderDetails({ order }: { order: OrderView }) {
  return (
    <section className={styles.order} aria-label={`Заказ ${order.number}`}>
      <p className={styles.orderTitle}>
        Заказ {order.number} · {orderStatusLabel(order.status)}
      </p>
      <ul className={styles.orderItems}>
        {order.items.map((item, i) => (
          <li key={i}>
            <span>
              {item.showTitle ? `${item.showTitle}, ` : ''}
              {item.title}
              {item.seat && `, ${item.seat}`} × {item.quantity}
            </span>
            <b>{formatRub(item.lineGrossKopecks)}</b>
          </li>
        ))}
      </ul>
      <dl className={styles.orderSum}>
        {order.bonusKopecks > 0 && (
          <div>
            <dt>Оплачено бонусами</dt>
            <dd>−{formatRub(order.bonusKopecks)}</dd>
          </div>
        )}
        {order.feeKopecks > 0 && (
          <div>
            <dt>Сервисный сбор</dt>
            <dd>{formatRub(order.feeKopecks)}</dd>
          </div>
        )}
        <div>
          <dt>Оплачено деньгами</dt>
          <dd>{formatRub(order.cashKopecks)}</dd>
        </div>
      </dl>
    </section>
  )
}
