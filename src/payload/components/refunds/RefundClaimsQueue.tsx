'use client'

import { Button } from '@payloadcms/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { formatRub } from '@/lib/money'

import { useAdminDialog } from '../AdminDialog'
import s from './refunds.module.css'

/**
 * Очередь заявок на возврат (/admin/refunds, вкладка «Заявки»). Каждую заявку решает сотрудник:
 * одобрить с процентом номинала (подставлено, что положено по закону) — деньги уходят через банк
 * обычным возвратом; или отказать с объяснением, которое увидит зритель. На карточке — главное для
 * решения: сколько дней было до спектакля при подаче (шкала сроков закона) и сумма к возврату,
 * которая пересчитывается сразу при смене процента.
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
  ticketAmounts: Amounts[]
  decidedPercent: number | null
  decisionComment: string | null
  decidedBy: string | null
  decidedAt: string | null
  createdAt: string
}

type List = { open: Claim[]; closed: Claim[] }

/** Событие для счётчика на вкладке «Заявки». */
export const CLAIMS_COUNT_EVENT = 'refund-claims:count'

const DAY = 24 * 60 * 60_000
const TZ = 'Asia/Yekaterinburg'

const dateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', {
        timeZone: TZ,
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** «8 дней», «2 дня», «5 часов» — понятная длительность для шкалы. */
const span = (ms: number) => {
  if (ms < DAY) {
    const h = Math.max(0, Math.floor(ms / 3_600_000))
    return `${h} ${plural(h, 'час', 'часа', 'часов')}`
  }
  const d = Math.floor(ms / DAY)
  return `${d} ${plural(d, 'день', 'дня', 'дней')}`
}

/** Сумма как на сервере (refundAmounts): по билету, копейки вниз; сбор — целиком или нет. */
const amountsAt = (tickets: Amounts[], percent: number, includeFee: boolean): Amounts => {
  const part = (k: number) => Math.floor((k * percent) / 100)
  return tickets.reduce(
    (sum, t) => {
      const fee = includeFee ? t.feeKopecks : 0
      return {
        cashKopecks: sum.cashKopecks + part(t.cashKopecks) + fee,
        bonusKopecks: sum.bonusKopecks + part(t.bonusKopecks),
        feeKopecks: sum.feeKopecks + fee,
      }
    },
    { cashKopecks: 0, bonusKopecks: 0, feeKopecks: 0 },
  )
}

const STATUS: Record<Claim['status'], { label: string; className: string }> = {
  SUBMITTED: { label: 'На рассмотрении', className: s.chipWarn! },
  APPROVED: { label: 'Одобрена', className: s.chipOk! },
  REJECTED: { label: 'Отказ', className: s.chipBad! },
  CANCELLED: { label: 'Отозвана зрителем', className: '' },
}

/** Шкала сроков закона (14+ → 0 дней) и отметка «когда подана заявка». */
function Timeline({ claim, now }: { claim: Claim; now: number }) {
  const start = new Date(claim.startsAt).getTime()
  const before = start - new Date(claim.createdAt).getTime()
  const left = start - now
  // 14 дней — ширина шкалы; всё, что раньше, — у левого края.
  const position = Math.min(1, Math.max(0, 1 - before / (14 * DAY)))
  return (
    <div className={s.timeline}>
      <div className={s.timelineHead}>
        <span>
          Подана за <b>{span(before)}</b> до спектакля
        </span>
        <span className={s.muted}>
          {left > 0 ? (
            <>
              До спектакля: <b>{span(left)}</b>
            </>
          ) : (
            'Спектакль прошёл'
          )}
        </span>
      </div>
      <div
        className={s.track}
        role="img"
        aria-label={`Заявка подана за ${span(before)} до спектакля`}
      >
        <span className={`${s.seg} ${s.seg100}`}>100%</span>
        <span className={`${s.seg} ${s.seg50}`}>≥ 50%</span>
        <span className={`${s.seg} ${s.seg30}`}>≥ 30%</span>
        <span className={`${s.seg} ${s.seg0}`}>док.</span>
        <span className={s.marker} style={{ left: `${position * 100}%` }} />
      </div>
      <div className={s.scale} aria-hidden="true">
        <span>14+ дн.</span>
        <span>10 дн.</span>
        <span>5</span>
        <span>3 · спектакль</span>
      </div>
    </div>
  )
}

function ClaimCard({
  claim,
  apiUrl,
  dialog,
  now,
  onDone,
}: {
  claim: Claim
  apiUrl: string
  dialog: ReturnType<typeof useAdminDialog>
  now: number
  onDone: (message: string) => void
}) {
  const [percent, setPercent] = useState(claim.legalPercent > 0 ? claim.legalPercent : 0)
  const [includeFee, setIncludeFee] = useState(claim.includeFee)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const open = claim.status === 'SUBMITTED'

  const shown = open ? percent : (claim.decidedPercent ?? 0)
  const preview = useMemo(
    () => amountsAt(claim.ticketAmounts, shown, open ? includeFee : claim.includeFee),
    [claim.ticketAmounts, claim.includeFee, shown, includeFee, open],
  )
  const feeTotal = claim.ticketAmounts.reduce((n, t) => n + t.feeKopecks, 0)
  const valid = Number.isInteger(percent) && percent >= 1 && percent <= 100
  const below = claim.legalPercent > 0 && percent < claim.legalPercent

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
      const data = (await res.json().catch(() => ({}))) as { message?: string }
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
    if (!valid) {
      setError('Процент — целое число от 1 до 100.')
      return
    }
    const ok = await dialog.confirm({
      title: `Вернуть ${formatRub(preview.cashKopecks)}?`,
      body: (
        <div className={s.stack}>
          <p style={{ margin: 0 }}>
            {percent}% номинала{includeFee ? ' и сервисный сбор' : ''} по заявке {claim.number}.
            Деньги уйдут через банк на карту зрителя, билеты {claim.ticketNumbers.join(', ')}{' '}
            перестанут действовать.
          </p>
          {preview.bonusKopecks > 0 && (
            <p style={{ margin: 0 }}>Бонусами вернётся {formatRub(preview.bonusKopecks)}.</p>
          )}
          {below && (
            <p style={{ margin: 0, color: 'var(--theme-error-500)' }}>
              Это меньше, чем положено по закону ({claim.legalPercent}%).
            </p>
          )}
        </div>
      ),
      confirmLabel: 'Вернуть',
      danger: below,
    })
    if (!ok) return
    if (await post('approve', { percent, includeFee }))
      onDone(
        `Заявка ${claim.number} одобрена: ${formatRub(preview.cashKopecks)} отправлено в банк.`,
      )
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

  const status = STATUS[claim.status]
  const presets = [...new Set([claim.legalPercent, 50, 100].filter((p) => p > 0))]

  return (
    <article
      className={`${s.claim} ${open ? s.claimOpen : ''}`}
      aria-label={`Заявка ${claim.number}`}
    >
      <header className={s.claimHead}>
        <span className={s.claimNumber}>{claim.number}</span>
        <span className={`${s.chip} ${status.className}`}>{status.label}</span>
        <span className={s.meta}>подана {dateTime(claim.createdAt)}</span>
      </header>

      <div className={s.claimBody}>
        <div className={s.stack}>
          <div>
            <p className={s.show}>{claim.showTitle ?? 'Спектакль'}</p>
            <p className={s.meta}>
              {dateTime(claim.startsAt)} · заказ {claim.orderNumber} ·{' '}
              {claim.ticketNumbers.length > 1
                ? `билеты ${claim.ticketNumbers.join(', ')}`
                : `билет ${claim.ticketNumbers[0] ?? '—'}`}
              {claim.customerEmail && ` · ${claim.customerEmail}`}
            </p>
          </div>
          <div>
            <p className={s.reason}>
              Причина: <b>{claim.reasonLabel}</b>
            </p>
            {claim.comment && <p className={s.quote}>«{claim.comment}»</p>}
          </div>
          <Timeline claim={claim} now={now} />
          {(claim.documentRequired || claim.files.length > 0) && (
            <div className={s.files}>
              <span className={s.muted}>Документы:</span>
              {claim.files.length === 0 ? (
                <span className={`${s.chip} ${s.chipWarn}`}>
                  ещё не прислали · до {dateTime(claim.documentDeadline)}
                </span>
              ) : (
                claim.files.map((f) => (
                  <a
                    key={f.id}
                    className={s.file}
                    href={`${apiUrl}/files/${f.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {f.mimeType === 'application/pdf' ? 'PDF' : 'Фото'} · {f.name}
                  </a>
                ))
              )}
            </div>
          )}
        </div>

        <aside className={s.money} aria-label="Сумма возврата">
          <span className={s.moneyLabel}>
            {open ? 'Вернётся на карту' : claim.status === 'APPROVED' ? 'Возвращено' : 'Возврат'}
          </span>
          <span className={`${s.moneyValue} ${shown === 0 ? s.moneyZero : ''}`}>
            {formatRub(preview.cashKopecks)}
          </span>
          <span className={s.moneyNote}>
            {shown}% номинала
            {preview.bonusKopecks > 0 && ` + ${formatRub(preview.bonusKopecks)} бонусами`}
          </span>
          {feeTotal > 0 && (
            <span className={s.moneyNote}>
              Сбор {formatRub(feeTotal)} —{' '}
              {(open ? includeFee : claim.includeFee) ? 'возвращается' : 'не возвращается'}
            </span>
          )}
          <span className={s.moneyNote} style={{ marginTop: 8 }}>
            По закону: <b>{claim.legalPercent}%</b>. {claim.basisText}
          </span>
        </aside>
      </div>

      {open ? (
        <div className={s.decision}>
          <label className={s.percent} title="Процент номинала к возврату">
            <input
              type="number"
              min={1}
              max={100}
              inputMode="numeric"
              aria-label="Процент к возврату"
              value={percent || ''}
              placeholder="0"
              onChange={(e) => setPercent(Math.round(Number(e.target.value) || 0))}
            />
            <span>%</span>
          </label>
          <div className={s.presets} role="group" aria-label="Быстрый выбор процента">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                className={s.preset}
                aria-pressed={percent === p}
                onClick={() => setPercent(p)}
              >
                {p === claim.legalPercent ? `по закону ${p}%` : `${p}%`}
              </button>
            ))}
          </div>
          {feeTotal > 0 && (
            <label className={s.check}>
              <input
                type="checkbox"
                checked={includeFee}
                onChange={(e) => setIncludeFee(e.target.checked)}
              />
              вернуть сбор
            </label>
          )}
          <span className={s.spacer} />
          <Button buttonStyle="secondary" disabled={busy} onClick={reject}>
            Отказать
          </Button>
          <Button buttonStyle="primary" disabled={busy || !valid} onClick={approve}>
            {valid ? `Вернуть ${formatRub(preview.cashKopecks)}` : 'Укажите %'}
          </Button>
        </div>
      ) : (
        (claim.decisionComment || claim.decidedBy) && (
          <p className={s.decided}>
            {claim.decisionComment && <>«{claim.decisionComment}» </>}
            {claim.decidedBy && `— ${claim.decidedBy}, ${dateTime(claim.decidedAt)}`}
          </p>
        )
      )}
      {error && (
        <p role="alert" className={s.alert}>
          {error}
        </p>
      )}
    </article>
  )
}

export function RefundClaimsQueue({ apiUrl }: { apiUrl: string }) {
  const dialog = useAdminDialog()
  const [data, setData] = useState<List | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  // «Сейчас» — один раз на загрузку списка: шкала и «до спектакля» не дёргаются при вводе.
  const [now, setNow] = useState(() => Date.now())

  const fetchList = useCallback(async (): Promise<List | null> => {
    try {
      const res = await fetch(apiUrl, { credentials: 'include', cache: 'no-store' })
      return res.ok ? ((await res.json()) as List) : null
    } catch {
      return null
    }
  }, [apiUrl])

  const apply = useCallback((list: List | null) => {
    if (list) {
      setData(list)
      setNow(Date.now())
      window.dispatchEvent(new CustomEvent(CLAIMS_COUNT_EVENT, { detail: list.open.length }))
    }
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
    <section className={s.stack} aria-label="Заявки на возврат">
      {dialog.element}
      <div className={s.queueHead}>
        <p className={s.rules}>
          Ст. 52.1 Закона о культуре, ПП № 1491: больше 10 дней — 100%, 5–10 дней — не меньше 50%,
          3–5 дней — не меньше 30%, меньше 3 дней — только болезнь или смерть близкого с документом.
          Акционные билеты — только по уважительной причине.
        </p>
      </div>
      {error && (
        <p role="alert" className={s.alert}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={s.notice}>
          {notice}
        </p>
      )}
      {data && data.open.length === 0 && <div className={s.empty}>Новых заявок нет</div>}
      {data?.open.map((c) => (
        <ClaimCard
          key={c.id}
          claim={c}
          apiUrl={apiUrl}
          dialog={dialog}
          now={now}
          onDone={(m) => {
            setNotice(m)
            void load()
          }}
        />
      ))}
      {data && data.closed.length > 0 && (
        <div className={s.closed}>
          <h3 className={s.closedTitle}>Решённые · {data.closed.length}</h3>
          <ul className={s.list}>
            {data.closed.map((c) => {
              const expanded = openId === c.id
              const status = STATUS[c.status]
              const sum = amountsAt(c.ticketAmounts, c.decidedPercent ?? 0, c.includeFee)
              return (
                <li key={c.id} className={s.listItem}>
                  <button
                    type="button"
                    className={s.listRow}
                    aria-expanded={expanded}
                    aria-controls={`claim-${c.id}`}
                    onClick={() => setOpenId(expanded ? null : c.id)}
                  >
                    <span className={s.claimNumber}>{c.number}</span>
                    <span className={`${s.chip} ${status.className}`}>{status.label}</span>
                    <span className={s.listShow}>{c.showTitle ?? 'Спектакль'}</span>
                    <span className={`${s.num} ${s.listSum}`}>
                      {c.status === 'APPROVED'
                        ? `${formatRub(sum.cashKopecks)} · ${c.decidedPercent}%`
                        : '—'}
                    </span>
                    <span className={s.meta}>{dateTime(c.decidedAt ?? c.createdAt)}</span>
                    <span className={s.chevron} aria-hidden="true">
                      {expanded ? '▴' : '▾'}
                    </span>
                  </button>
                  {expanded && (
                    <div id={`claim-${c.id}`} className={s.listDetail}>
                      <ClaimCard
                        claim={c}
                        apiUrl={apiUrl}
                        dialog={dialog}
                        now={now}
                        onDone={() => {}}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
