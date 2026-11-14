'use client'

import { Button } from '@payloadcms/ui'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'

import { formatRub } from '@/lib/money'

import { useAdminDialog } from '../AdminDialog'

/**
 * Очередь заявок на возврат (/admin/refunds). Каждую заявку решает сотрудник: одобрить с процентом
 * номинала (подставлено, что положено по закону) — деньги уходят через банк обычным возвратом;
 * или отказать с объяснением, которое увидит зритель. Документы открываются в новой вкладке.
 */

type Amounts = { cashKopecks: number; bonusKopecks: number; feeKopecks: number }

type Claim = {
  id: string
  number: string
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  orderNumber: string
  ticketNumbers: string[]
  reasonLabel: string
  comment: string | null
  startsAt: string
  showTitle: string | null
  customerEmail: string | null
  legalPercent: number
  basisText: string
  includeFee: boolean
  documentRequired: boolean
  documentDeadline: string | null
  files: { id: string; name: string; mimeType: string; sizeBytes: number; uploadedAt: string }[]
  legalAmounts: Amounts
  decidedPercent: number | null
  decisionComment: string | null
  decidedBy: string | null
  decidedAt: string | null
  createdAt: string
}

const box: CSSProperties = {
  padding: '1rem',
  border: '1px solid var(--theme-elevation-150)',
  marginBottom: '1rem',
}
const muted: CSSProperties = { color: 'var(--theme-elevation-600)' }
const input: CSSProperties = { padding: '0.4rem 0.5rem', width: '6rem' }
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' }) : '—'

const STATUS: Record<Claim['status'], string> = {
  SUBMITTED: 'на рассмотрении',
  APPROVED: 'одобрена',
  REJECTED: 'отказ',
  CANCELLED: 'отозвана зрителем',
}

function ClaimCard({
  claim,
  apiUrl,
  dialog,
  onDone,
}: {
  claim: Claim
  apiUrl: string
  dialog: ReturnType<typeof useAdminDialog>
  onDone: (message: string) => void
}) {
  const [percent, setPercent] = useState(claim.legalPercent > 0 ? String(claim.legalPercent) : '')
  const [includeFee, setIncludeFee] = useState(claim.includeFee)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const post = async (path: string, body: unknown) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${apiUrl}/${claim.id}/${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
      if (!res.ok) setError(data.message ?? 'Не получилось. Обновите страницу и повторите.')
      return res.ok
    } catch {
      setError('Нет связи с сервером.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const approve = async () => {
    const p = Number(percent)
    if (!Number.isInteger(p) || p < 1 || p > 100) {
      setError('Процент — целое число от 1 до 100.')
      return
    }
    const below = claim.legalPercent > 0 && p < claim.legalPercent
    const ok = await dialog.confirm({
      title: `Вернуть ${p}% по заявке ${claim.number}?`,
      body: (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <p style={{ margin: 0 }}>
            Деньги уйдут через банк на карту зрителя
            {includeFee ? ', вместе с сервисным сбором' : ', без сервисного сбора'}. Билеты{' '}
            {claim.ticketNumbers.join(', ')} перестанут действовать.
          </p>
          {below && (
            <p style={{ margin: 0, color: 'var(--theme-error-500)' }}>
              Меньше, чем положено по закону ({claim.legalPercent}%).
            </p>
          )}
        </div>
      ),
      confirmLabel: `Вернуть ${p}%`,
      danger: below,
    })
    if (!ok) return
    if (await post('approve', { percent: p, includeFee }))
      onDone(`Заявка ${claim.number} одобрена: возврат ${p}% отправлен в банк.`)
  }

  const reject = async () => {
    const comment = await dialog.prompt({
      title: `Отказать по заявке ${claim.number}?`,
      body: <p style={{ margin: 0 }}>Объяснение увидит зритель в личном кабинете.</p>,
      label: 'Причина отказа',
      placeholder: 'Например: до спектакля меньше трёх дней, по закону возврат не положен…',
      minLength: 3,
      confirmLabel: 'Отказать',
      danger: true,
    })
    if (!comment) return
    if (await post('reject', { comment })) onDone(`По заявке ${claim.number} — отказ.`)
  }

  const open = claim.status === 'SUBMITTED'
  return (
    <article style={box} aria-label={`Заявка ${claim.number}`}>
      <p style={{ margin: '0 0 0.25rem' }}>
        <b>{claim.number}</b> · {STATUS[claim.status]} · подана {time(claim.createdAt)}
      </p>
      <p style={{ margin: '0 0 0.25rem' }}>
        {claim.showTitle ?? 'Спектакль'}, {time(claim.startsAt)} · заказ {claim.orderNumber} ·
        билеты {claim.ticketNumbers.join(', ')}
        {claim.customerEmail && ` · ${claim.customerEmail}`}
      </p>
      <p style={{ margin: '0 0 0.25rem' }}>
        Причина: <b>{claim.reasonLabel}</b>
        {claim.comment && <> — «{claim.comment}»</>}
      </p>
      <p style={{ margin: '0 0 0.5rem', ...muted }}>
        По закону: <b>{claim.legalPercent}%</b>
        {claim.legalPercent > 0 &&
          ` (${formatRub(claim.legalAmounts.cashKopecks)} на карту${claim.legalAmounts.bonusKopecks ? `, ${formatRub(claim.legalAmounts.bonusKopecks)} бонусами` : ''})`}
        . {claim.basisText}
      </p>

      {(claim.documentRequired || claim.files.length > 0) && (
        <div style={{ margin: '0 0 0.5rem' }}>
          Документы:{' '}
          {claim.files.length === 0 ? (
            <span style={{ color: 'var(--theme-warning-500, #b26a00)' }}>
              ещё не прислали (можно до {time(claim.documentDeadline)})
            </span>
          ) : (
            claim.files.map((f, i) => (
              <span key={f.id}>
                {i > 0 && ', '}
                <a href={`${apiUrl}/files/${f.id}`} target="_blank" rel="noopener noreferrer">
                  {f.name}
                </a>
              </span>
            ))
          )}
        </div>
      )}

      {open ? (
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label>
            Вернуть,{' '}
            <input
              style={input}
              type="number"
              min={1}
              max={100}
              value={percent}
              placeholder="%"
              onChange={(e) => setPercent(e.target.value)}
            />{' '}
            %
          </label>
          <label>
            <input
              type="checkbox"
              checked={includeFee}
              onChange={(e) => setIncludeFee(e.target.checked)}
            />{' '}
            со сбором
          </label>
          <Button buttonStyle="primary" disabled={busy || !percent} onClick={approve}>
            Одобрить
          </Button>
          <Button buttonStyle="secondary" disabled={busy} onClick={reject}>
            Отказать
          </Button>
        </div>
      ) : (
        <p style={{ margin: 0, ...muted }}>
          {claim.status === 'APPROVED' && `Возвращено ${claim.decidedPercent}%. `}
          {claim.decisionComment && `«${claim.decisionComment}» `}
          {claim.decidedBy && `— ${claim.decidedBy}, ${time(claim.decidedAt)}`}
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--theme-error-500)', margin: '0.5rem 0 0' }}>
          {error}
        </p>
      )}
    </article>
  )
}

export function RefundClaimsQueue({ apiUrl }: { apiUrl: string }) {
  const dialog = useAdminDialog()
  const [data, setData] = useState<{ open: Claim[]; closed: Claim[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)

  type List = { open: Claim[]; closed: Claim[] }
  const fetchList = useCallback(async (): Promise<List | null> => {
    try {
      const res = await fetch(apiUrl, { credentials: 'include', cache: 'no-store' })
      return res.ok ? ((await res.json()) as List) : null
    } catch {
      return null
    }
  }, [apiUrl])

  const apply = useCallback((list: List | null) => {
    if (list) setData(list)
    setError(list ? null : 'Не удалось загрузить заявки.')
  }, [])

  const load = async () => apply(await fetchList())

  useEffect(() => {
    let alive = true
    void fetchList().then((list) => {
      if (alive) apply(list)
    })
    return () => {
      alive = false
    }
  }, [fetchList, apply])

  return (
    <section aria-label="Заявки на возврат">
      {dialog.element}
      {data && (
        <p style={{ margin: '0 0 0.5rem' }}>
          <b>
            {data.open.length === 0 ? 'Новых заявок нет' : `На рассмотрении: ${data.open.length}`}
          </b>
        </p>
      )}
      <p style={{ ...muted, marginTop: 0 }}>
        Правила — ст. 52.1 Закона о культуре и ПП № 1491: больше 10 дней — 100%, 5–10 дней — не
        меньше 50%, 3–5 дней — не меньше 30%, меньше 3 дней — только болезнь или смерть близкого с
        документом. Акционные билеты не возвращаются, кроме уважительных причин.
      </p>
      {error && (
        <p role="alert" style={{ color: 'var(--theme-error-500)' }}>
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {data?.open.map((c) => (
        <ClaimCard
          key={c.id}
          claim={c}
          apiUrl={apiUrl}
          dialog={dialog}
          onDone={(m) => {
            setNotice(m)
            void load()
          }}
        />
      ))}
      {data && data.closed.length > 0 && (
        <p>
          <button
            type="button"
            className="btn btn--style-none"
            onClick={() => setShowClosed((v) => !v)}
          >
            {showClosed ? 'Скрыть решённые' : `Показать решённые (${data.closed.length})`}
          </button>
        </p>
      )}
      {showClosed &&
        data?.closed.map((c) => (
          <ClaimCard key={c.id} claim={c} apiUrl={apiUrl} dialog={dialog} onDone={() => {}} />
        ))}
    </section>
  )
}
