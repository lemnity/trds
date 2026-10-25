'use client'

import { Button } from '@payloadcms/ui'
import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react'

import { certificateSerial } from '@/modules/loyalty'

/**
 * Сертификаты в админке (T-066): список, выпуск партии, аннулирование. Полные номера приходят
 * только в ответе на выпуск и живут лишь в памяти этой страницы: показываются один раз, их можно
 * скачать CSV или распечатать. После «Готово» их больше не увидеть — в базе только хеш.
 */

type Status = 'issued' | 'activated' | 'expired' | 'annulled'

type Item = {
  serial: number
  last4: string
  amountKopecks: number
  status: Status
  validUntil: string | null
  activatedAt: string | null
  activatedByCustomer: string | null
  comment: string | null
  createdAt: string
}

type Page = { items: Item[]; total: number; page: number; pageSize: number }
/** `serial` — уже в виде «С-000123» (как в CSV командной строки). */
type Issued = {
  certificates: { serial: string; code: string }[]
  amountRub: number
  validUntil: string | null
}

const STATUS_LABEL: Record<Status, string> = {
  issued: 'Выпущен',
  activated: 'Активирован',
  expired: 'Сгорел',
  annulled: 'Аннулирован',
}

const ERRORS: Record<string, string> = {
  not_annullable: 'Аннулировать нельзя: сертификат уже активирован или аннулирован.',
  reason_required: 'Укажите причину.',
  forbidden: 'Нет прав на это действие.',
  mfa_required: 'Подтвердите вход вторым фактором.',
  unauthorized: 'Сессия истекла — войдите снова.',
}

/** Открытый порядковый номер, как в кабинете: С-000123. */
const serialLabel = (n: number) => certificateSerial(n)
const rub = (kopecks: number) => `${(kopecks / 100).toLocaleString('ru-RU')} ₽`
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : '—'

const input: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.4rem 0.5rem',
  marginTop: 4,
}
const cell: CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid var(--theme-elevation-100)',
  textAlign: 'left',
}

export function CertificatesAdmin({ apiUrl }: { apiUrl: string }) {
  const [filter, setFilter] = useState<Status | ''>('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [form, setForm] = useState({ amountRub: '', count: '1', validUntil: '', comment: '' })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [issueError, setIssueError] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [issued, setIssued] = useState<Issued | null>(null)

  const [annulling, setAnnulling] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [annulError, setAnnulError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Загрузчик возвращает результат, состояние ставят вызывающие: эффект — асинхронно, в .then.
  const fetchPage = useCallback(async (): Promise<{ page: Page } | { error: string }> => {
    try {
      const q = new URLSearchParams({ page: String(page), ...(filter && { status: filter }) })
      const res = await fetch(`${apiUrl}?${q}`, { credentials: 'include', cache: 'no-store' })
      const body = (await res.json().catch(() => ({}))) as Page & { error?: string }
      if (!res.ok)
        return { error: ERRORS[String(body.error)] ?? 'Не удалось загрузить сертификаты.' }
      return { page: body }
    } catch {
      return { error: 'Нет связи с сервером.' }
    }
  }, [apiUrl, page, filter])

  const apply = (r: { page: Page } | { error: string }) => {
    if ('page' in r) {
      setData(r.page)
      setLoadError(null)
    } else setLoadError(r.error)
  }

  const load = async () => apply(await fetchPage())

  useEffect(() => {
    let alive = true
    void fetchPage().then((r) => {
      if (alive) apply(r)
    })
    return () => {
      alive = false
    }
  }, [fetchPage])

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return {
      ok: res.ok,
      body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
    }
  }

  const issue = async (e: FormEvent) => {
    e.preventDefault()
    const count = Number(form.count)
    const amount = Number(form.amountRub)
    if (
      !window.confirm(
        `Выпустить ${count} сертификат(ов) номиналом ${amount.toLocaleString('ru-RU')} ₽? ` +
          'Полные номера покажутся один раз.',
      )
    )
      return
    setIssuing(true)
    setIssueError(null)
    setFieldErrors({})
    try {
      const { ok, body } = await post('/issue', {
        amountRub: form.amountRub,
        count: form.count,
        validUntil: form.validUntil,
        comment: form.comment,
      })
      if (!ok) {
        setFieldErrors((body.fields as Record<string, string>) ?? {})
        setIssueError(ERRORS[String(body.error)] ?? 'Не удалось выпустить. Проверьте поля.')
        return
      }
      setIssued(body as unknown as Issued)
      setForm({ amountRub: '', count: '1', validUntil: '', comment: '' })
      setPage(1)
      await load()
    } catch {
      setIssueError('Нет связи с сервером. Проверьте список: партия могла выпуститься.')
    } finally {
      setIssuing(false)
    }
  }

  const downloadCsv = () => {
    if (!issued) return
    const csv = [
      'serial,code,amount_rub,valid_until',
      ...issued.certificates.map(
        (c) => `${c.serial},${c.code},${issued.amountRub},${issued.validUntil ?? ''}`,
      ),
    ].join('\n')
    const url = URL.createObjectURL(new Blob([`${csv}\n`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `certificates-${issued.certificates[0]?.serial ?? 'batch'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const annul = async (e: FormEvent) => {
    e.preventDefault()
    if (annulling === null) return
    setBusy(true)
    setAnnulError(null)
    try {
      const { ok, body } = await post(`/${annulling}/annul`, { reason })
      if (!ok) {
        setAnnulError(ERRORS[String(body.error)] ?? 'Не удалось аннулировать.')
        return
      }
      setNotice(`${serialLabel(annulling)} аннулирован.`)
      setAnnulling(null)
      setReason('')
      await load()
    } catch {
      setAnnulError('Нет связи с сервером.')
    } finally {
      setBusy(false)
    }
  }

  if (issued)
    return (
      <section style={{ marginTop: '2rem' }} aria-labelledby="issued-title">
        <h1 id="issued-title">Выпущено: {issued.certificates.length}</h1>
        <p role="alert">
          Полные номера показываются один раз и нигде больше не хранятся. Скачайте CSV или
          распечатайте, храните в защищённом месте, не пересылайте открытыми каналами.
        </p>
        <p>
          <Button onClick={downloadCsv}>Скачать CSV</Button>{' '}
          <Button buttonStyle="secondary" onClick={() => window.print()}>
            Распечатать
          </Button>
        </p>
        <table style={{ borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 15 }}>
          <thead>
            <tr>
              <th style={cell}>Номер</th>
              <th style={cell}>Код</th>
              <th style={cell}>Номинал</th>
              <th style={cell}>Действует до</th>
            </tr>
          </thead>
          <tbody>
            {issued.certificates.map((c) => (
              <tr key={c.serial}>
                <td style={cell}>{c.serial}</td>
                <td style={{ ...cell, userSelect: 'all' }}>{c.code}</td>
                <td style={cell}>{issued.amountRub.toLocaleString('ru-RU')} ₽</td>
                <td style={cell}>{issued.validUntil ?? 'бессрочно'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ marginTop: '1.5rem' }}>
          <Button
            onClick={() => {
              if (window.confirm('Номера сохранены? После этого их больше не показать.'))
                setIssued(null)
            }}
          >
            Готово, номера сохранены
          </Button>
        </p>
      </section>
    )

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <section style={{ marginTop: '2rem', marginBottom: '3rem' }} aria-labelledby="cert-title">
      <h1 id="cert-title">Подарочные сертификаты</h1>

      <form
        onSubmit={issue}
        style={{
          maxWidth: 520,
          padding: '1rem',
          background: 'var(--theme-elevation-50)',
          borderRadius: 8,
        }}
        aria-labelledby="issue-title"
        noValidate
      >
        <h2 id="issue-title" style={{ fontSize: 18, marginTop: 0 }}>
          Выпустить партию
        </h2>
        {(
          [
            ['amountRub', 'Номинал, ₽', 'number', { min: 1, step: 1, required: true }],
            [
              'count',
              'Количество (до 500)',
              'number',
              { min: 1, max: 500, step: 1, required: true },
            ],
            ['validUntil', 'Действует до (включительно; пусто — бессрочно)', 'date', {}],
            ['comment', 'Комментарий (для кого партия)', 'text', { maxLength: 500 }],
          ] as const
        ).map(([name, label, type, attrs]) => (
          <label key={name} style={{ display: 'block', marginBottom: '0.75rem' }}>
            {label}
            <input
              style={input}
              type={type}
              name={name}
              value={form[name]}
              onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
              aria-invalid={fieldErrors[name] ? true : undefined}
              aria-describedby={fieldErrors[name] ? `err-${name}` : undefined}
              {...attrs}
            />
            {fieldErrors[name] && (
              <span id={`err-${name}`} style={{ color: 'var(--theme-error-500)', fontSize: 13 }}>
                {fieldErrors[name]}
              </span>
            )}
          </label>
        ))}
        {issueError && (
          <p role="alert" style={{ color: 'var(--theme-error-500)' }}>
            {issueError}
          </p>
        )}
        <Button type="submit" disabled={issuing || !form.amountRub || !form.count}>
          {issuing ? 'Выпускаем…' : 'Выпустить'}
        </Button>
      </form>

      <h2 style={{ fontSize: 18, marginTop: '2rem' }}>Выпущенные</h2>
      <label style={{ display: 'inline-block', marginBottom: '0.75rem' }}>
        Статус{' '}
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Status | '')
            setPage(1)
          }}
        >
          <option value="">Все</option>
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <p role="status" aria-live="polite" style={{ minHeight: '1.5em' }}>
        {notice ?? loadError}
      </p>

      {annulling !== null && (
        <form
          onSubmit={annul}
          style={{
            maxWidth: 520,
            padding: '1rem',
            border: '1px solid var(--theme-elevation-150)',
            borderRadius: 8,
            marginBottom: '1rem',
          }}
        >
          <h3 style={{ marginTop: 0 }}>Аннулировать {serialLabel(annulling)}</h3>
          <p>Активировать его станет нельзя. Отменить аннулирование нельзя.</p>
          <label style={{ display: 'block', marginBottom: '0.75rem' }}>
            Причина (обязательно)
            <input
              style={input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              minLength={3}
              maxLength={500}
              autoFocus
              aria-invalid={annulError ? true : undefined}
            />
          </label>
          {annulError && (
            <p role="alert" style={{ color: 'var(--theme-error-500)' }}>
              {annulError}
            </p>
          )}
          <Button type="submit" disabled={busy || reason.trim().length < 3}>
            {busy ? 'Аннулируем…' : 'Аннулировать'}
          </Button>{' '}
          <Button
            buttonStyle="secondary"
            onClick={() => {
              setAnnulling(null)
              setReason('')
              setAnnulError(null)
            }}
          >
            Отмена
          </Button>
        </form>
      )}

      {!data ? (
        <p aria-busy="true">{loadError ? '' : 'Загружаем…'}</p>
      ) : data.items.length === 0 ? (
        <p>Сертификатов нет.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
            <thead>
              <tr>
                <th style={cell}>Номер</th>
                <th style={cell}>Последние 4</th>
                <th style={cell}>Номинал</th>
                <th style={cell}>Статус</th>
                <th style={cell}>Действует до</th>
                <th style={cell}>Активирован</th>
                <th style={cell}>Комментарий</th>
                <th style={cell}>
                  <span style={{ position: 'absolute', left: -9999 }}>Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.serial}>
                  <td style={cell}>{serialLabel(c.serial)}</td>
                  <td style={{ ...cell, fontFamily: 'monospace' }}>…{c.last4}</td>
                  <td style={cell}>{rub(c.amountKopecks)}</td>
                  <td style={cell}>{STATUS_LABEL[c.status]}</td>
                  <td style={cell}>{c.validUntil ? day(c.validUntil) : 'бессрочно'}</td>
                  <td style={cell}>
                    {c.activatedAt
                      ? `${day(c.activatedAt)} · покупатель ${c.activatedByCustomer?.slice(0, 8)}`
                      : '—'}
                  </td>
                  <td style={cell}>{c.comment ?? ''}</td>
                  <td style={cell}>
                    {c.status === 'issued' && (
                      <Button
                        buttonStyle="secondary"
                        size="small"
                        onClick={() => {
                          setAnnulling(c.serial)
                          setNotice(null)
                        }}
                      >
                        Аннулировать
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <Button
              buttonStyle="secondary"
              size="small"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Назад
            </Button>{' '}
            Страница {data.page} из {pages} · всего {data.total}{' '}
            <Button
              buttonStyle="secondary"
              size="small"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Дальше
            </Button>
          </p>
        </div>
      )}
    </section>
  )
}
