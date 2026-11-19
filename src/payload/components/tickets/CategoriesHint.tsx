'use client'

import {
  useAuth,
  useConfig,
  useDocumentDrawer,
  useDocumentInfo,
  useFormFields,
} from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { entrySeats, entryTicketState, showIdOf } from './entryTicket'
import { categoriesHint } from './hintText'

const muted = { margin: '0 0 var(--base)', color: 'var(--theme-elevation-500)' } as const

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: 'include' })
  return res.ok ? res.json() : null
}

/** Описание блока категорий + кнопка «Добавить входной билет» для показов без схемы зала. */
export function CategoriesHint() {
  const planId = useFormFields(([fields]) => fields['seating.planId']?.value)
  const showValue = useFormFields(([fields]) => fields['show']?.value)
  const { id } = useDocumentInfo()
  const { permissions } = useAuth()
  const router = useRouter()
  const {
    config: {
      serverURL,
      routes: { api },
    },
  } = useConfig()
  const canCreate = Boolean(permissions?.collections?.['ticket-types']?.create)
  const showId = showIdOf(showValue)
  const [seatsFor, setSeatsFor] = useState<{ key: unknown; value: number | null } | null>(null)
  const [catsFor, setCatsFor] = useState<{ key: unknown; value: boolean } | null>(null)
  const seats = seatsFor && seatsFor.key === showId ? seatsFor.value : null
  const hasCategories = catsFor && catsFor.key === id ? catsFor.value : null
  const [Drawer, , { openDrawer }] = useDocumentDrawer({ collectionSlug: 'ticket-types' })

  useEffect(() => {
    let cancelled = false
    if (showId === null) return
    void getJson(`${serverURL}${api}/shows/${showId}?depth=0&draft=true`)
      .then((doc) => {
        if (!cancelled)
          setSeatsFor({
            key: showId,
            value: entrySeats(
              (doc as { seatsPerPerformance?: unknown } | null)?.seatsPerPerformance,
            ),
          })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [showId, serverURL, api])

  useEffect(() => {
    let cancelled = false
    if (!id) return
    void getJson(`${serverURL}${api}/ticket-types?where[performance][equals]=${id}&limit=1&depth=0`)
      .then((res) => {
        const docs = (res as { docs?: unknown[] } | null)?.docs
        if (!cancelled && Array.isArray(docs)) setCatsFor({ key: id, value: docs.length > 0 })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [id, serverURL, api])

  const state = entryTicketState({ saved: Boolean(id), planId, seats, canCreate, hasCategories })

  return (
    <div>
      <p style={muted}>{categoriesHint(typeof planId === 'string' ? planId : null)}</p>
      {state.kind === 'save-first' && (
        <p style={muted}>Сохраните показ, чтобы добавить входной билет.</p>
      )}
      {state.kind === 'button' && id ? (
        <div style={{ margin: '0 0 var(--base)' }}>
          <button
            type="button"
            className="btn btn--style-primary btn--size-medium"
            onClick={openDrawer}
          >
            {`Добавить входной билет на ${state.seats} мест`}
          </button>
          <Drawer
            initialData={{
              performance: id,
              title: 'Входной билет',
              code: 'standard',
              capacity: state.seats,
            }}
            onSave={() => {
              setCatsFor({ key: id, value: true })
              router.refresh()
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
