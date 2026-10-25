'use client'

import { buttonVariants } from '@heroui/styles'
import { useState } from 'react'

import { ButtonLink } from '../ui/ButtonLink'
import { InlineNotice } from '../ui/InlineNotice'
import { PageTabs } from '../ui/PageTabs'
import { TicketIcon } from '../ui/TicketIcon'
import accountStyles from './Account.module.css'
import { DemoBadge } from './BonusSection'
import { TicketDialog } from './TicketDialog'
import styles from './Tickets.module.css'
import {
  TICKET_STATE_LABELS,
  findOrder,
  formatTicketDate,
  ticketPlace,
  type AccountTickets,
  type TicketView,
} from './tickets-view'
import { reloadTickets, useAccountTickets } from './useAccountTickets'

function Empty({ title, text, action }: { title: string; text: string; action?: boolean }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true">
        <TicketIcon />
      </span>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyText}>{text}</p>
      {action && <ButtonLink href="/afisha">Выбрать спектакль</ButtonLink>}
    </div>
  )
}

function TicketCard({
  ticket,
  data,
  demo,
}: {
  ticket: TicketView
  data: AccountTickets
  demo: boolean
}) {
  const [open, setOpen] = useState(false)
  const [refund, setRefund] = useState(false)
  const { date, time } = formatTicketDate(ticket.startsAt)
  // Возврат — только у действующего билета на будущий показ (как и в диалоге).
  const refundable = ticket.state === 'valid' && Boolean(ticket.qrUrl)
  const show = (withRefund: boolean) => {
    setRefund(withRefund)
    setOpen(true)
  }
  return (
    <li className={styles.card} data-state={ticket.state}>
      <div className={styles.cardBody}>
        <p className={styles.when}>
          <b>{date}</b>
          {time && <span>{time}</span>}
        </p>
        <p className={styles.title}>{ticket.show?.title ?? 'Спектакль снят с афиши'}</p>
        {ticket.venue && (
          <p className={styles.meta}>
            {ticket.venue.title}, {ticket.venue.address}
          </p>
        )}
        <p className={styles.meta}>{ticketPlace(ticket)}</p>
        <p className={styles.status}>
          <span className={styles.chip} data-state={ticket.state}>
            {TICKET_STATE_LABELS[ticket.state]}
          </span>
          <span className={styles.number}>{ticket.number}</span>
          {demo && <DemoBadge />}
        </p>
      </div>
      <div className={styles.actions}>
        {refundable && (
          <button
            type="button"
            className={buttonVariants({ variant: 'outline', className: styles.open })}
            onClick={() => show(true)}
            aria-haspopup="dialog"
            aria-label={`Вернуть билет ${ticket.number}`}
          >
            Вернуть
          </button>
        )}
        <button
          type="button"
          className={buttonVariants({
            variant: ticket.qrUrl ? 'primary' : 'outline',
            className: styles.open,
          })}
          onClick={() => show(false)}
          aria-haspopup="dialog"
        >
          {ticket.qrUrl ? 'Показать QR' : 'Подробнее'}
        </button>
      </div>
      {open && (
        <TicketDialog
          ticket={ticket}
          order={findOrder(data, ticket)}
          isOpen={open}
          onOpenChange={setOpen}
          demo={demo}
          startRefund={refund}
        />
      )}
    </li>
  )
}

const List = ({
  items,
  data,
  demo,
}: {
  items: TicketView[]
  data: AccountTickets
  demo: boolean
}) => (
  <ul className={styles.list}>
    {items.map((t) => (
      <TicketCard key={t.number} ticket={t} data={data} demo={demo} />
    ))}
  </ul>
)

/**
 * «Мои билеты» (T-051, PRD «Кабинет»): будущие, прошедшие, возвраты. Данные — сервер
 * (`/api/account/tickets`, только билеты покупателя из сессии), на превью — демо.
 */
export function TicketsSection() {
  const state = useAccountTickets()

  if (state.status === 'loading')
    return (
      <p className={styles.loading} aria-busy="true">
        Загружаем билеты…
      </p>
    )
  if (state.status === 'unavailable')
    return (
      <InlineNotice tone="warning" title="Билеты временно недоступны">
        Не получилось загрузить список. Билеты продолжают действовать — они есть в письме после
        покупки.{' '}
        <button type="button" className={accountStyles.retry} onClick={() => void reloadTickets()}>
          Повторить
        </button>
      </InlineNotice>
    )
  if (state.status === 'guest')
    return (
      <Empty
        title="Войдите, чтобы увидеть билеты"
        text="Билеты, купленные на этом сайте, появятся здесь после входа в личный кабинет."
      />
    )

  const { data, demo } = state
  return (
    <PageTabs
      label="Мои билеты"
      tabs={[
        {
          id: 'upcoming',
          label: 'Будущие',
          count: data.upcoming.length,
          panel: data.upcoming.length ? (
            <List items={data.upcoming} data={data} demo={demo} />
          ) : (
            <Empty
              title="Билетов пока нет"
              text="Здесь появятся билеты, купленные на этом сайте: QR-код для входа, дата, площадка и статус."
              action
            />
          ),
        },
        {
          id: 'past',
          label: 'Прошедшие',
          count: data.past.length,
          panel: data.past.length ? (
            <List items={data.past} data={data} demo={demo} />
          ) : (
            <Empty
              title="Пока пусто"
              text="После спектакля билет переедет сюда — с датой и площадкой, чтобы вспомнить вечер."
            />
          ),
        },
        {
          id: 'refunded',
          label: 'Возвраты',
          count: data.refunded.length,
          panel: data.refunded.length ? (
            <List items={data.refunded} data={data} demo={demo} />
          ) : (
            <Empty
              title="Возвратов нет"
              text="Если вернёте билет, здесь будет его статус: «в обработке» или «деньги возвращены»."
            />
          ),
        },
      ]}
    />
  )
}
