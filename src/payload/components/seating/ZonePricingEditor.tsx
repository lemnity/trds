'use client'

import type { ReactNode } from 'react'

import { formatRub } from '@/lib/money'
import type { SeatPricing, ZonePlan } from '@/modules/seating'

import { PriceInput } from './SeatPricingEditor'
import styles from './seatPricing.module.css'

/**
 * Редактор зонной схемы (Хлебозавод): зоны стопкой от сцены, у каждой — название, цена и
 * вместимость. Зона без цены или с нулевой вместимостью не продаётся. Управляемый, как
 * SeatPricingEditor; `pricing` — полный (completeZonePricing).
 */
type Props = {
  plan: ZonePlan
  pricing: SeatPricing
  onChange: (next: SeatPricing) => void
  readOnly?: boolean
  toolbar?: ReactNode
}

const ticketsWord = (n: number) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'билет'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'билета'
  return 'билетов'
}

export function ZonePricingEditor({ plan, pricing, onChange, readOnly, toolbar }: Props) {
  const planColor = new Map(plan.zones.map((z) => [z.id, z.color]))
  const colorOf = (z: { categoryId: string; color?: string | null }) =>
    z.color ?? planColor.get(z.categoryId) ?? '#888888'
  const update = (
    zoneId: string,
    patch: Partial<{
      title: string
      priceKopecks: number | null
      capacity: number | null
      color: string
    }>,
  ) =>
    onChange({
      ...pricing,
      zones: pricing.zones.map((z) => (z.categoryId === zoneId ? { ...z, ...patch } : z)),
    })

  const onSale = pricing.zones.filter((z) => z.priceKopecks !== null && (z.capacity ?? 0) > 0)
  const capacity = onSale.reduce((n, z) => n + (z.capacity ?? 0), 0)
  const revenue = onSale.reduce((n, z) => n + z.priceKopecks! * (z.capacity ?? 0), 0)

  return (
    <div className={styles.root}>
      {toolbar}
      <div className={styles.layout}>
        <div className={styles.hall}>
          <div className={styles.stage}>Сцена</div>
          <ol className={styles.zoneStack} aria-label={`${plan.title}: зоны от сцены`}>
            {pricing.zones.map((z) => {
              const sold = z.priceKopecks !== null && (z.capacity ?? 0) > 0
              return (
                <li
                  key={z.categoryId}
                  className={styles.zoneBlock}
                  data-off={!sold}
                  style={{ '--zone': colorOf(z) } as React.CSSProperties}
                >
                  <span className={styles.zoneBlockTitle}>{z.title}</span>
                  <span className={styles.zoneBlockMeta}>
                    {sold
                      ? `${formatRub(z.priceKopecks!)} · ${z.capacity} ${ticketsWord(z.capacity!)}`
                      : 'не продаётся'}
                  </span>
                </li>
              )
            })}
          </ol>
          <div className={styles.hint}>
            Зоны без мест: билет даёт вход в зону, рассадка свободная внутри неё.
          </div>
        </div>

        <div className={styles.side}>
          <div className={styles.sideHead}>
            <h4 className={styles.sideTitle}>Зоны и цены</h4>
          </div>
          <ul className={styles.zones}>
            {pricing.zones.map((z) => (
              <li key={z.categoryId} className={styles.zoneRow}>
                <label
                  className={styles.colorPicker}
                  style={{ '--zone': colorOf(z) } as React.CSSProperties}
                  title="Цвет зоны"
                >
                  <input
                    type="color"
                    aria-label={`Цвет зоны «${z.title}»`}
                    value={colorOf(z)}
                    disabled={readOnly}
                    onChange={(e) => update(z.categoryId, { color: e.target.value.toLowerCase() })}
                  />
                </label>
                <input
                  className={styles.zoneTitle}
                  aria-label="Название зоны"
                  value={z.title}
                  disabled={readOnly}
                  onChange={(e) => update(z.categoryId, { title: e.target.value })}
                />
                <PriceInput
                  label={`Цена зоны «${z.title}», ₽`}
                  value={z.priceKopecks}
                  disabled={readOnly}
                  onCommit={(v) => update(z.categoryId, { priceKopecks: v })}
                />
                <span className={styles.capacityInput}>
                  <input
                    inputMode="numeric"
                    aria-label={`Вместимость зоны «${z.title}», билетов`}
                    placeholder="—"
                    value={z.capacity ?? ''}
                    disabled={readOnly}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\s/g, '')
                      if (raw === '') return update(z.categoryId, { capacity: null })
                      if (/^\d{1,5}$/.test(raw)) update(z.categoryId, { capacity: Number(raw) })
                    }}
                  />
                  <span aria-hidden="true">мест</span>
                </span>
              </li>
            ))}
          </ul>
          <dl className={styles.summary}>
            <div>
              <dt>Зон в продаже</dt>
              <dd>
                {onSale.length} из {pricing.zones.length}
              </dd>
            </div>
            <div>
              <dt>Билетов</dt>
              <dd>{capacity}</dd>
            </div>
            <div />
            <div className={styles.revenue}>
              <dt>Полный зал</dt>
              <dd>{formatRub(revenue)}</dd>
            </div>
          </dl>
          <p className={styles.muted} style={{ margin: 0 }}>
            Вместимость нельзя поставить ниже уже проданного — сохранение будет отклонено.
          </p>
        </div>
      </div>
    </div>
  )
}
