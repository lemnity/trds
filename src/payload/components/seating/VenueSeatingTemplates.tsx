'use client'

import { useConfig, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { useEffect, useMemo, useState } from 'react'

import { type SeatPricing } from '@/modules/seating'

import { useAdminDialog } from '../AdminDialog'
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate,
  type SeatTemplate,
} from './api'
import { HallPricingEditor, completeHallPricing, hallOf, type Hall } from './hall'
import styles from './seatPricing.module.css'

/**
 * Площадка → «Шаблоны цен зала»: выбрана схема зала — показываем зал, раскидываем цены по
 * местам и сохраняем шаблоном. Шаблоны пишутся сразу (REST), независимо от кнопки «Сохранить»
 * площадки; в показе их применяют одной кнопкой.
 */
export function VenueSeatingTemplates() {
  const { config } = useConfig()
  const apiUrl = `${config.serverURL}${config.routes.api}`
  const { id: venueId } = useDocumentInfo()
  const planId = useFormFields(([f]) => f.seatingPlanId?.value as string | null | undefined)
  const hall = planId ? hallOf(planId) : null

  return (
    <div className={styles.root}>
      <h3 style={{ margin: 0 }}>Схема зала и шаблоны цен</h3>
      {!hall ? (
        <div className={styles.notice}>
          Выберите схему зала выше — здесь появится зал, где можно раскидать цены по местам и
          сохранить их шаблоном.
        </div>
      ) : venueId === undefined || venueId === null ? (
        <div className={styles.notice}>Сохраните площадку, чтобы создавать шаблоны цен.</div>
      ) : (
        // key: другая площадка или схема — свежее состояние редактора.
        <TemplatesManager
          key={`${venueId}:${hall.plan.id}`}
          apiUrl={apiUrl}
          venueId={venueId}
          hall={hall}
        />
      )}
    </div>
  )
}

function TemplatesManager({
  apiUrl,
  venueId,
  hall,
}: {
  apiUrl: string
  venueId: number | string
  hall: Hall
}) {
  const planId = hall.plan.id
  const dialog = useAdminDialog()

  const [list, setList] = useState<SeatTemplate[]>([])
  const [activeId, setActiveId] = useState<string>('new')
  const [draft, setDraft] = useState<SeatPricing | null>(null)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const active = list.find((t) => String(t.id) === activeId) ?? null
  const pricing = useMemo(() => completeHallPricing(hall, draft), [hall, draft])

  const load = () =>
    listTemplates(apiUrl, { venue: venueId, planId })
      .then(setList)
      .catch(() => setList([]))

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const open = async (id: string) => {
    if (
      dirty &&
      !(await dialog.confirm({
        title: 'Несохранённые изменения',
        body: 'Изменения в текущем шаблоне пропадут.',
        confirmLabel: 'Перейти',
        danger: true,
      }))
    )
      return
    const t = list.find((x) => String(x.id) === id)
    setActiveId(id)
    setDraft(t?.pricing ?? null)
    setDirty(false)
    setStatus(null)
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  const saveNew = () =>
    run(async () => {
      const title = await dialog.prompt({
        title: 'Новый шаблон цен',
        label: 'Название шаблона',
        placeholder: 'Например, «Премьера» или «Будни»',
        confirmLabel: 'Сохранить',
      })
      if (!title) return
      const doc = await createTemplate(apiUrl, { title, venue: venueId, planId, pricing })
      await load()
      setActiveId(String(doc.id))
      setDirty(false)
      setStatus(`Шаблон «${title}» сохранён.`)
    })

  const saveActive = () =>
    run(async () => {
      if (!active) return
      await updateTemplate(apiUrl, active.id, { pricing, planId })
      await load()
      setDirty(false)
      setStatus(`Шаблон «${active.title}» обновлён.`)
    })

  const rename = () =>
    run(async () => {
      if (!active) return
      const title = await dialog.prompt({
        title: 'Переименовать шаблон',
        label: 'Название',
        confirmLabel: 'Сохранить',
      })
      if (!title) return
      await updateTemplate(apiUrl, active.id, { title })
      await load()
    })

  const remove = () =>
    run(async () => {
      if (!active) return
      const ok = await dialog.confirm({
        title: `Удалить шаблон «${active.title}»?`,
        body: 'Показы, к которым его уже применили, не изменятся.',
        confirmLabel: 'Удалить',
        danger: true,
      })
      if (!ok) return
      await deleteTemplate(apiUrl, active.id)
      await load()
      setActiveId('new')
      setDraft(null)
      setDirty(false)
      setStatus('Шаблон удалён.')
    })

  return (
    <>
      {dialog.element}
      <HallPricingEditor
        hall={hall}
        pricing={pricing}
        onChange={(next) => {
          setDraft(next)
          setDirty(true)
        }}
        toolbar={
          <div className={styles.toolbar}>
            <strong>Шаблон</strong>
            <select
              aria-label="Шаблон цен"
              value={activeId}
              onChange={(e) => void open(e.target.value)}
            >
              <option value="new">Новый шаблон</option>
              {list.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.title}
                </option>
              ))}
            </select>
            {active && (
              <>
                <button type="button" className={styles.link} onClick={() => void rename()}>
                  Переименовать
                </button>
                <button type="button" className={styles.link} onClick={() => void remove()}>
                  Удалить
                </button>
              </>
            )}
            <span className={styles.toolbarSpacer} />
            {status && <span className={styles.muted}>{status}</span>}
            {active && (
              <button
                type="button"
                className={styles.chip}
                disabled={busy || !dirty}
                onClick={() => void saveActive()}
              >
                Сохранить изменения
              </button>
            )}
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => void saveNew()}
            >
              Сохранить как шаблон
            </button>
          </div>
        }
      />
    </>
  )
}
