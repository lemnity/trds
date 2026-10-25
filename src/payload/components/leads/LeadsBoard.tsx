'use client'

import { Button } from '@payloadcms/ui'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react'

import { LEAD_FORMATS } from '@/modules/leads'

/**
 * Канбан корпоративов (T-065, design.md §10): колонки «Новые», «В работе», «Готово» и архив.
 * Карточка — минимум персональных данных (имя, формат, дата, гости); контакты — только в
 * подробностях. Перевод — перетаскиванием или списком «Перевести» (клавиатура). Статус на экране
 * меняется только после ответа сервера: визуальный успех не заменяет подтверждённый статус.
 */

type Status = 'new' | 'in_progress' | 'done' | 'archived'

type Card = {
  id: string
  status: Status
  format: string
  name: string
  eventDate: string | null
  guests: number | null
  assignee: string | null
  createdAt: string
  duplicate: boolean
}

type History = {
  id: string
  fromStatus: Status | null
  toStatus: Status
  actor: string | null
  createdAt: string
}

type Detail = Card & {
  email: string | null
  phone: string | null
  budget: string | null
  comment: string | null
  source: string
  duplicateOf: string | null
  history: History[]
}

type Board = {
  cards: Card[]
  staff: { id: string; label: string }[]
  transitions: Record<Status, Status[]>
  clientEmailEnabled: boolean
}

const COLUMNS: { status: Status; title: string }[] = [
  { status: 'new', title: 'Новые' },
  { status: 'in_progress', title: 'В работе' },
  { status: 'done', title: 'Готово' },
]

const STATUS_LABEL: Record<Status, string> = {
  new: 'Новые',
  in_progress: 'В работе',
  done: 'Готово',
  archived: 'Архив',
}

const ERRORS: Record<string, string> = {
  conflict: 'Карточку уже изменил другой сотрудник — доска обновлена.',
  not_found: 'Заявка не найдена — доска обновлена.',
  invalid_transition: 'Такой переход недоступен.',
  unknown_staff: 'Сотрудник не найден.',
  forbidden: 'Нет прав на это действие.',
  mfa_required: 'Подтвердите вход вторым фактором.',
  unauthorized: 'Сессия истекла — войдите снова.',
}

const formatLabel = (id: string) => LEAD_FORMATS.find((f) => f.id === id)?.label ?? id

const dateRu = (iso: string | null) =>
  iso
    ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'дата не указана'

const timeRu = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Yekaterinburg',
  })

const column: CSSProperties = {
  flex: '1 1 0',
  minWidth: 240,
  background: 'var(--theme-elevation-50)',
  borderRadius: 8,
  padding: '0.75rem',
}

const cardStyle: CSSProperties = {
  background: 'var(--theme-elevation-0)',
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: 6,
  padding: '0.6rem 0.75rem',
  marginBottom: '0.5rem',
}

export function LeadsBoard({ apiUrl }: { apiUrl: string }) {
  const [board, setBoard] = useState<Board | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [showArchive, setShowArchive] = useState(false)
  const [dragOver, setDragOver] = useState<Status | null>(null)

  // Загрузчики возвращают результат, состояние ставят вызывающие: эффект — асинхронно, в .then.
  const fetchBoard = useCallback(async (): Promise<{ board: Board } | { error: string }> => {
    try {
      const res = await fetch(apiUrl, { credentials: 'include', cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as Board & { error?: string }
      if (!res.ok) return { error: ERRORS[String(data.error)] ?? 'Не удалось загрузить заявки.' }
      return { board: data }
    } catch {
      return { error: 'Нет связи с сервером.' }
    }
  }, [apiUrl])

  const fetchDetail = useCallback(
    async (id: string): Promise<{ lead: Detail } | { error: string }> => {
      try {
        const res = await fetch(`${apiUrl}/${id}`, { credentials: 'include', cache: 'no-store' })
        const data = (await res.json().catch(() => ({}))) as { lead?: Detail; error?: string }
        if (!res.ok || !data.lead)
          return { error: ERRORS[String(data.error)] ?? 'Не удалось открыть заявку.' }
        return { lead: data.lead }
      } catch {
        return { error: 'Нет связи с сервером.' }
      }
    },
    [apiUrl],
  )

  const applyBoard = (r: { board: Board } | { error: string }) => {
    if ('board' in r) {
      setBoard(r.board)
      setLoadError(null)
    } else setLoadError(r.error)
  }

  const applyDetail = (r: { lead: Detail } | { error: string }) => {
    if ('lead' in r) {
      setDetail(r.lead)
      setDetailError(null)
    } else {
      setDetail(null)
      setDetailError(r.error)
    }
  }

  const load = async () => applyBoard(await fetchBoard())
  const loadDetail = async (id: string) => applyDetail(await fetchDetail(id))

  useEffect(() => {
    let alive = true
    void fetchBoard().then((r) => {
      if (alive) applyBoard(r)
    })
    return () => {
      alive = false
    }
  }, [fetchBoard])

  useEffect(() => {
    if (!selected) return
    let alive = true
    void fetchDetail(selected).then((r) => {
      if (alive) applyDetail(r)
    })
    return () => {
      alive = false
    }
  }, [selected, fetchDetail])

  // Подробности показываем только для выбранной карточки (после «Закрыть» — ничего).
  const shownDetail = detail && detail.id === selected ? detail : null
  const shownDetailError = selected ? detailError : null

  const staffLabel = useMemo(() => {
    const map = new Map((board?.staff ?? []).map((s) => [s.id, s.label]))
    return (id: string | null) => (id ? (map.get(id) ?? `сотрудник #${id}`) : null)
  }, [board])

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    return { ok: res.ok, error: data.error }
  }

  const move = async (card: Card, to: Status) => {
    if (card.status === to || busyId) return
    if (!board?.transitions[card.status]?.includes(to)) {
      setNotice(ERRORS.invalid_transition!)
      return
    }
    setBusyId(card.id)
    setNotice(null)
    try {
      const result = await post(`/${card.id}/move`, { from: card.status, to })
      if (!result.ok)
        setNotice(
          ERRORS[String(result.error)] ?? 'Не удалось перевести карточку. Попробуйте ещё раз.',
        )
      else setNotice(`«${card.name}» → ${STATUS_LABEL[to]}`)
      await load()
      if (selected === card.id) await loadDetail(card.id)
    } catch {
      setNotice('Нет связи с сервером — статус не изменён.')
    } finally {
      setBusyId(null)
    }
  }

  const assign = async (lead: Detail, assignee: string) => {
    setBusyId(lead.id)
    setNotice(null)
    try {
      const result = await post(`/${lead.id}/assign`, {
        expected: lead.assignee,
        assignee: assignee || null,
      })
      if (!result.ok)
        setNotice(ERRORS[String(result.error)] ?? 'Не удалось назначить ответственного.')
      await Promise.all([load(), loadDetail(lead.id)])
    } catch {
      setNotice('Нет связи с сервером — ответственный не изменён.')
    } finally {
      setBusyId(null)
    }
  }

  const onDrop = (to: Status) => (e: DragEvent) => {
    e.preventDefault()
    setDragOver(null)
    const id = e.dataTransfer.getData('text/plain')
    const card = board?.cards.find((c) => c.id === id)
    if (card) void move(card, to)
  }

  if (loadError && !board)
    return (
      <section style={{ marginTop: '2rem' }}>
        <h1>Корпоративы</h1>
        <p role="alert">{loadError}</p>
        <Button onClick={() => void load()}>Повторить</Button>
      </section>
    )

  if (!board)
    return (
      <section style={{ marginTop: '2rem' }} aria-busy="true">
        <h1>Корпоративы</h1>
        <p>Загружаем заявки…</p>
      </section>
    )

  const renderCard = (card: Card) => {
    const targets = board.transitions[card.status] ?? []
    const busy = busyId === card.id
    return (
      <li
        key={card.id}
        draggable={!busyId}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', card.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        style={{
          ...cardStyle,
          listStyle: 'none',
          opacity: busy ? 0.6 : 1,
          outline: selected === card.id ? '2px solid var(--theme-success-500)' : undefined,
        }}
        aria-busy={busy || undefined}
      >
        <button
          type="button"
          onClick={() => setSelected(card.id === selected ? null : card.id)}
          style={{
            background: 'none',
            border: 0,
            padding: 0,
            font: 'inherit',
            color: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
            display: 'block',
            width: '100%',
          }}
          aria-expanded={selected === card.id}
          aria-controls="lead-detail"
        >
          <strong>{card.name}</strong>
          {card.duplicate && (
            <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--theme-warning-650)' }}>
              возможный повтор
            </span>
          )}
          <br />
          <span style={{ fontSize: 13 }}>
            {formatLabel(card.format)} · {dateRu(card.eventDate)}
            {card.guests ? ` · ${card.guests} гостей` : ''}
          </span>
          <br />
          <span style={{ fontSize: 12, color: 'var(--theme-elevation-500)' }}>
            {staffLabel(card.assignee) ?? 'без ответственного'}
          </span>
        </button>
        <div style={{ marginTop: 6, fontSize: 12 }}>
          <select
            aria-label={`Перевести «${card.name}»`}
            value=""
            disabled={!!busyId || targets.length === 0}
            onChange={(e) => {
              if (e.target.value) void move(card, e.target.value as Status)
            }}
            style={{ width: '100%' }}
          >
            <option value="">{busy ? 'Сохраняем…' : 'Перевести в…'}</option>
            {targets.map((t) => (
              <option key={t} value={t}>
                {STATUS_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
      </li>
    )
  }

  const archived = board.cards.filter((c) => c.status === 'archived')

  return (
    <section style={{ marginTop: '2rem', marginBottom: '3rem' }} aria-labelledby="leads-title">
      <h1 id="leads-title">Корпоративы</h1>
      <p style={{ color: 'var(--theme-elevation-600)' }}>
        Перетащите карточку в колонку или выберите «Перевести в…». Контакты — в карточке заявки.
      </p>
      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginBottom: '1rem' }}>
        <input type="checkbox" disabled checked={false} readOnly />
        Сообщать клиенту о смене статуса письмом
        <span style={{ fontSize: 12, color: 'var(--theme-elevation-500)' }}>
          (включится после решения театра)
        </span>
      </label>
      <p role="status" aria-live="polite" style={{ minHeight: '1.5em' }}>
        {notice ?? loadError}
      </p>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {COLUMNS.map(({ status, title }) => {
          const cards = board.cards.filter((c) => c.status === status)
          return (
            <div
              key={status}
              style={{
                ...column,
                boxShadow:
                  dragOver === status ? 'inset 0 0 0 2px var(--theme-success-500)' : undefined,
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(status)
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={onDrop(status)}
              aria-labelledby={`col-${status}`}
              role="region"
            >
              <h2 id={`col-${status}`} style={{ fontSize: 16, margin: '0 0 0.75rem' }}>
                {title} <span style={{ color: 'var(--theme-elevation-500)' }}>{cards.length}</span>
              </h2>
              <ul style={{ margin: 0, padding: 0 }}>
                {cards.length ? (
                  cards.map(renderCard)
                ) : (
                  <li style={{ listStyle: 'none' }}>Пусто</li>
                )}
              </ul>
            </div>
          )
        })}

        {shownDetail || shownDetailError ? (
          <aside
            id="lead-detail"
            aria-label="Заявка"
            style={{
              ...column,
              flex: '1 1 320px',
              background: 'var(--theme-elevation-0)',
              border: '1px solid var(--theme-elevation-150)',
            }}
          >
            {shownDetailError ? (
              <p role="alert">{shownDetailError}</p>
            ) : shownDetail ? (
              <>
                <h2 style={{ fontSize: 18, marginTop: 0 }}>{shownDetail.name}</h2>
                <dl
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr',
                    gap: '4px 12px',
                    margin: 0,
                  }}
                >
                  <dt>Статус</dt>
                  <dd>{STATUS_LABEL[shownDetail.status]}</dd>
                  <dt>Формат</dt>
                  <dd>{formatLabel(shownDetail.format)}</dd>
                  <dt>Дата</dt>
                  <dd>{dateRu(shownDetail.eventDate)}</dd>
                  <dt>Гостей</dt>
                  <dd>{shownDetail.guests ?? '—'}</dd>
                  <dt>Почта</dt>
                  <dd>
                    {shownDetail.email ? (
                      <a href={`mailto:${shownDetail.email}`}>{shownDetail.email}</a>
                    ) : (
                      '—'
                    )}
                  </dd>
                  <dt>Телефон</dt>
                  <dd>
                    {shownDetail.phone ? (
                      <a href={`tel:${shownDetail.phone}`}>{shownDetail.phone}</a>
                    ) : (
                      '—'
                    )}
                  </dd>
                  <dt>Бюджет</dt>
                  <dd>{shownDetail.budget ?? '—'}</dd>
                  <dt>Комментарий</dt>
                  <dd style={{ whiteSpace: 'pre-wrap' }}>{shownDetail.comment ?? '—'}</dd>
                  <dt>Получена</dt>
                  <dd>{timeRu(shownDetail.createdAt)}</dd>
                </dl>
                {shownDetail.duplicateOf && (
                  <p style={{ fontSize: 13 }}>
                    Возможный повтор: с этого контакта была заявка за последние сутки.
                  </p>
                )}
                <label style={{ display: 'block', margin: '1rem 0' }}>
                  Ответственный
                  <select
                    value={shownDetail.assignee ?? ''}
                    disabled={!!busyId}
                    onChange={(e) => void assign(shownDetail, e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: 4 }}
                  >
                    <option value="">Не назначен</option>
                    {board.staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <h3 style={{ fontSize: 15 }}>История</h3>
                <ol style={{ paddingLeft: '1.2rem', fontSize: 13 }}>
                  {shownDetail.history.map((h) => (
                    <li key={h.id}>
                      {timeRu(h.createdAt)}:{' '}
                      {h.fromStatus ? `${STATUS_LABEL[h.fromStatus]} → ` : 'создана → '}
                      {STATUS_LABEL[h.toStatus]}
                      {' · '}
                      {h.actor ? staffLabel(h.actor) : 'посетитель сайта'}
                    </li>
                  ))}
                </ol>
                <Button buttonStyle="secondary" onClick={() => setSelected(null)}>
                  Закрыть
                </Button>
              </>
            ) : null}
          </aside>
        ) : null}
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        <Button
          buttonStyle="secondary"
          onClick={() => setShowArchive((v) => !v)}
          aria-expanded={showArchive}
        >
          {showArchive ? 'Скрыть архив' : `Архив (${archived.length})`}
        </Button>
        {showArchive && (
          <div
            style={{ ...column, marginTop: '0.75rem', maxWidth: 480 }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop('archived')}
            role="region"
            aria-label="Архив"
          >
            <ul style={{ margin: 0, padding: 0 }}>
              {archived.length ? (
                archived.map(renderCard)
              ) : (
                <li style={{ listStyle: 'none' }}>Пусто</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
