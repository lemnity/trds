'use client'

import type { ComponentProps } from 'react'

import {
  completePricing,
  completeZonePricing,
  getSeatingPlan,
  getZonePlan,
  type SeatPricing,
  type SeatingPlan,
  type ZonePlan,
} from '@/modules/seating'

import { SeatPricingEditor } from './SeatPricingEditor'
import { ZonePricingEditor } from './ZonePricingEditor'

/** Схема зала из select «Схема»: с нумерованными местами или зонная (Хлебозавод). */
export type Hall = { kind: 'seats'; plan: SeatingPlan } | { kind: 'zones'; plan: ZonePlan }

export const hallOf = (planId: string): Hall | null => {
  const seats = getSeatingPlan(planId)
  if (seats) return { kind: 'seats', plan: seats }
  const zones = getZonePlan(planId)
  return zones ? { kind: 'zones', plan: zones } : null
}

export const completeHallPricing = (hall: Hall, pricing: SeatPricing | null): SeatPricing =>
  hall.kind === 'seats'
    ? completePricing(hall.plan, pricing)
    : completeZonePricing(hall.plan, pricing)

type Props = Omit<ComponentProps<typeof SeatPricingEditor>, 'plan'> & { hall: Hall }

/** Нужный редактор под схему: места — выделение на схеме, зоны — цена и вместимость. */
export function HallPricingEditor({ hall, ...props }: Props) {
  if (hall.kind === 'seats') return <SeatPricingEditor plan={hall.plan} {...props} />
  const { pricing, onChange, readOnly, toolbar } = props
  return (
    <ZonePricingEditor
      plan={hall.plan}
      pricing={pricing}
      onChange={onChange}
      readOnly={readOnly}
      toolbar={toolbar}
    />
  )
}
