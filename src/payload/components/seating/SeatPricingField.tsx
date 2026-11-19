'use client'

import { FieldLabel, useConfig, useField, useFormFields } from '@payloadcms/ui'
import type { JSONFieldClientProps } from 'payload'
import { useEffect, useMemo, useRef, useState } from 'react'

import { parseSeatPricing, type SeatPricing } from '@/modules/seating'

import { useAdminDialog } from '../AdminDialog'
import { createTemplate, fetchVenuePlanId, listTemplates, type SeatTemplate } from './api'
import { HallPricingEditor, completeHallPricing, hallOf } from './hall'
import styles from './seatPricing.module.css'

/**
 * Поле «Цены по схеме зала» (JSON `pricing`) — у показа и у шаблона цен. Схема берётся из
 * соседнего поля `planPath`; у показа при выборе площадки схема подставляется из площадки.
 * С `templates` — панель «Применить шаблон / Сохранить как шаблон».
 */
type Props = JSONFieldClientProps & {
  planPath: string
  venuePath?: string
  closedPath?: string
  templates?: boolean
}

type Id = number | string

const idOf = (v: unknown): Id | null =>
  v && typeof v === 'object' && 'id' in v
    ? (v as { id: Id }).id
    : typeof v === 'number' || typeof v === 'string'
      ? v || null
      : null

export function SeatPricingField(props: Props) {
  const { path, field, readOnly, planPath, venuePath, closedPath, templates } = props
  const { config } = useConfig()
  const dialog = useAdminDialog()
  const apiUrl = `${config.serverURL}${config.routes.api}`

  const { value, setValue, errorMessage, showError } = useField<SeatPricing | null>({ path })
  const plan = useField<string | null>({ path: planPath })
  const closed = useField<string[] | null>({ path: closedPath ?? `${path}__none` })
  const venueRaw = useFormFields(([fields]) => (venuePath ? fields[venuePath]?.value : undefined))
  const venueId = idOf(venueRaw)

  const hall = plan.value ? hallOf(plan.value) : null
  const parsed = useMemo(() => parseSeatPricing(value, plan.value), [value, plan.value])
  const pricing = useMemo(
    () => (hall ? completeHallPricing(hall, parsed.ok ? parsed.pricing : null) : null),
    [hall, parsed],
  )

  // Площадка выбрана → схема зала площадки (если у показа ещё нет своей).
  const [venueNote, setVenueNote] = useState<string | null>(null)
  const lastVenue = useRef<Id | null>(venueId)
  useEffect(() => {
    if (!venuePath || venueId === null) return
    const changed = lastVenue.current !== venueId
    lastVenue.current = venueId
    if (plan.value && !changed) return
    let cancelled = false
    fetchVenuePlanId(apiUrl, venueId)
      .then((planId) => {
        if (cancelled) return
        if (!planId) {
          setVenueNote('У площадки нет схемы зала — продажа по категориям билетов.')
          return
        }
        setVenueNote(null)
        if (planId !== plan.value && (!plan.value || !parsed.ok || !parsed.pricing))
          plan.setValue(planId)
      })
      .catch(() => !cancelled && setVenueNote('Не удалось загрузить схему площадки.'))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId])

  // Схема выбрана (вручную или из площадки) — места, закрытые на схеме театра по умолчанию
  // (серые на схеме бара «Дом Культуры»), сразу «закрыты с продажи»; их включают на показ.
  const lastPlan = useRef(plan.value)
  useEffect(() => {
    if (lastPlan.current === plan.value) return
    lastPlan.current = plan.value
    const defaults = hall?.kind === 'seats' ? hall.plan.defaultClosedSeatIds : undefined
    if (closedPath && defaults?.length && (closed.value ?? []).length === 0)
      closed.setValue([...defaults])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.value])

  const label = <FieldLabel label={field.label ?? 'Цены по схеме зала'} path={path} />

  if (!hall || !pricing)
    return (
      <div className={styles.root}>
        {label}
        <div className={styles.notice}>
          {venueNote ?? 'Выберите площадку со схемой зала или схему выше — здесь появится зал.'}
        </div>
      </div>
    )

  return (
    <div className={styles.root}>
      {label}
      {showError && errorMessage && <div className={styles.error}>{errorMessage}</div>}
      {dialog.element}
      <HallPricingEditor
        key={hall.plan.id}
        hall={hall}
        pricing={pricing}
        onChange={(next) => setValue(next)}
        readOnly={readOnly}
        {...(closedPath && {
          closedSeatIds: closed.value ?? [],
          onClosedChange: (ids: string[]) => closed.setValue(ids),
          confirmOpenAll: (count: number) =>
            dialog.confirm({
              title: `Открыть все закрытые места (${count})?`,
              body: 'Все закрытые места вернутся в продажу. Изменение вступит в силу после сохранения показа.',
              confirmLabel: 'Открыть все',
            }),
        })}
        toolbar={
          templates ? (
            <TemplateBar
              apiUrl={apiUrl}
              planId={hall.plan.id}
              venueId={venueId}
              pricing={pricing}
              readOnly={readOnly}
              onApply={(p) => setValue(completeHallPricing(hall, p))}
            />
          ) : undefined
        }
      />
    </div>
  )
}

function TemplateBar({
  apiUrl,
  planId,
  venueId,
  pricing,
  readOnly,
  onApply,
}: {
  apiUrl: string
  planId: string
  venueId: Id | null
  pricing: SeatPricing
  readOnly?: boolean
  onApply: (p: SeatPricing | null) => void
}) {
  const dialog = useAdminDialog()
  const [list, setList] = useState<SeatTemplate[]>([])
  const [chosen, setChosen] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const load = () =>
    listTemplates(apiUrl, { planId })
      .then(setList)
      .catch(() => setList([]))

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId])

  const apply = async () => {
    const t = list.find((x) => String(x.id) === chosen)
    if (!t) return
    const ok = await dialog.confirm({
      title: `Применить шаблон «${t.title}»?`,
      body: 'Зоны и цены мест показа заменятся ценами шаблона. Закрытые места не меняются.',
      confirmLabel: 'Применить',
    })
    if (!ok) return
    onApply(t.pricing)
    setStatus(`Применён шаблон «${t.title}». Сохраните показ.`)
  }

  const save = async () => {
    if (venueId === null) return
    const title = await dialog.prompt({
      title: 'Сохранить как шаблон',
      body: 'Шаблон появится у площадки и в списке шаблонов этой схемы зала.',
      label: 'Название шаблона',
      placeholder: 'Например, «Премьера» или «Будни»',
      confirmLabel: 'Сохранить',
    })
    if (!title) return
    try {
      const doc = await createTemplate(apiUrl, { title, venue: venueId, planId, pricing })
      await load()
      setChosen(String(doc.id))
      setStatus(`Шаблон «${title}» сохранён.`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Не удалось сохранить шаблон')
    }
  }

  return (
    <div className={styles.toolbar}>
      {dialog.element}
      <strong>Шаблон цен</strong>
      <select
        aria-label="Шаблон цен"
        value={chosen}
        onChange={(e) => setChosen(e.target.value)}
        disabled={readOnly || list.length === 0}
      >
        <option value="">{list.length ? 'Выберите шаблон…' : 'Шаблонов пока нет'}</option>
        {list.map((t) => (
          <option key={t.id} value={String(t.id)}>
            {t.title}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={styles.chip}
        disabled={readOnly || !chosen}
        onClick={() => void apply()}
      >
        Применить
      </button>
      <span className={styles.toolbarSpacer} />
      {status && <span className={styles.muted}>{status}</span>}
      <button
        type="button"
        className={styles.primary}
        disabled={readOnly || venueId === null}
        title={venueId === null ? 'Сначала выберите площадку' : undefined}
        onClick={() => void save()}
      >
        Сохранить как шаблон
      </button>
    </div>
  )
}
