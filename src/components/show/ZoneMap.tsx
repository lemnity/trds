'use client'

import { formatRub } from '@/lib/money'
import type { ZonePlan } from '@/modules/seating'
import { remainingOf } from '@/modules/checkout'
import type { TicketType } from '@/modules/shows'

import styles from './ZoneMap.module.css'

type Props = {
  plan: ZonePlan
  ticketTypes: TicketType[]
  quantities: Record<string, number>
  /** Клик по зоне — плюс один билет в эту зону. */
  onPick: (type: TicketType) => void
  canAdd: (type: TicketType) => boolean
}

/**
 * Зонная схема зала (Хлебозавод) на странице спектакля: зоны от сцены, цена и остаток. Зона —
 * категория билетов: клик добавляет билет, количество правится в списке категорий ниже.
 */
export function ZoneMap({ plan, ticketTypes, quantities, onPick, canAdd }: Props) {
  const byId = new Map(ticketTypes.map((t) => [t.id, t]))
  return (
    <div className={styles.wrap}>
      <p className={styles.stage}>Сцена</p>
      <ul className={styles.zones} aria-label={`${plan.title}: зоны зала`}>
        {plan.zones.map((zone) => {
          const type = byId.get(zone.id)
          const left = type ? remainingOf(type) : 0
          const picked = type ? (quantities[type.id] ?? 0) : 0
          const meta = !type
            ? 'нет в продаже'
            : left <= 0
              ? 'билетов нет'
              : formatRub(type.priceKopecks)
          return (
            <li key={zone.id}>
              <button
                type="button"
                className={styles.zone}
                style={{ '--zone': zone.color } as React.CSSProperties}
                data-picked={picked > 0}
                disabled={!type || left <= 0 || !canAdd(type)}
                aria-label={`${type?.title ?? zone.title}: ${meta}${picked ? `, выбрано ${picked}` : ''}. Добавить билет`}
                onClick={() => type && onPick(type)}
              >
                <span className={styles.title}>{type?.title ?? zone.title}</span>
                <span className={styles.meta}>
                  {meta}
                  {picked > 0 && (
                    <span className={styles.badge} aria-hidden="true">
                      в заказе: {picked}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
