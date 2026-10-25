'use client'

import { Button } from '@payloadcms/ui'
import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react'

import { formatRub } from '@/lib/money'

/**
 * Возвраты в админке (T-053): поиск заказа, полный/частичный возврат с обязательной причиной,
 * список последних возвратов со статусом банка, повтор зависшего, политика возвратов. Все решения
 * принимает сервер; до подтверждения экран показывает сумму (rules.md §7). Статус «Выполнен» —
 * только после подтверждения банка (PAY-06).
 */

type RefundStatus = 'REQUESTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'MANUAL_REVIEW'

type Refund = {
  id: string
  orderNumber: string
  status: RefundStatus
  kind: 'customer' | 'staff'
  cashKopecks: number
  bonusKopecks: number
  feeKopecks: number
  bonusReversalKopecks: number
  ticketNumbers: string[]
  reason: string
  requestedBy: string
  providerStatus: string | null
  lastError: string | null
  attempts: number
  createdAt: string
  completedAt: string | null
  bonusSettledAt: string | null
}

type Policy = {
  customerRefundsEnabled: boolean
  deadlineHoursBeforeStart: number
  allowPartial: boolean
  refundServiceFee: boolean
  returnToSale: boolean
}

type OrderInfo = {
  order: {
    number: string
    status: string
    grossKopecks: number
    bonusKopecks: number
    feeKopecks: number
    cashKopecks: number
    paidAt: string | null
    guest: boolean
    reviewReason: string | null
  }
  tickets: {
    number: string
    status: 'ISSUED' | 'REFUND_PENDING' | 'REFUNDED'
    cashKopecks: number
    bonusKopecks: number
    feeKopecks: number
  }[]
  refunds: Refund[]
}

const STATUS_LABEL: Record<RefundStatus, string> = {
  REQUESTED: 'Запрошен (ждём банк)',
  PENDING: 'В обработке у банка',
  SUCCEEDED: 'Выполнен',
  FAILED: 'Отклонён банком',
  MANUAL_REVIEW: 'На ручном разборе',
}

const TICKET_LABEL = { ISSUED: 'Действует', REFUND_PENDING: 'Возврат идёт', REFUNDED: 'Возвращён' }

const ERRORS: Record<string, string> = {
  not_found: 'Заказ или билет не найден.',
  invalid: 'Проверьте номер заказа и выбор билетов.',
  reason_required: 'Укажите причину.',
  invalid_reason: 'Укажите причину (от 3 до 500 символов).',
  in_progress: 'По этим билетам уже идёт возврат.',
  not_refundable: 'Эти билеты вернуть нельзя (статус заказа или билета).',
  nothing_to_refund: 'В заказе нет действующих билетов.',
  payment_unavailable: 'Банк не подключён или платёж заказа неизвестен — верните через кассу.',
  not_retryable: 'Возврат уже завершён.',
  forbidden: 'Нет прав на это действие.',
  mfa_required: 'Подтвердите вход вторым фактором.',
  unauthorized: 'Сессия истекла — войдите снова.',
}

const box: CSSProperties = {
  padding: '1rem',
  border: '1px solid var(--theme-elevation-150)',
  marginBottom: '1.5rem',
}
const input: CSSProperties = { display: 'block', width: '100%', padding: '0.4rem 0.5rem' }
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const cell: CSSProperties = {
  padding: '0.35rem 0.5rem',
  borderBottom: '1px solid var(--theme-elevation-100)',
  textAlign: 'left',
  verticalAlign: 'top',
}
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' }) : '—'
const newKey = () => crypto.randomUUID()

export function RefundsPanel({
  apiUrl,
  canEditPolicy,
}: {
  apiUrl: string
  canEditPolicy: boolean
}) {
  const [recent, setRecent] = useState<Refund[]>([])
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [available, setAvailable] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [orderNumber, setOrderNumber] = useState('')
  const [info, setInfo] = useState<OrderInfo | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState('')
  const [includeFee, setIncludeFee] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [key, setKey] = useState(newKey)

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(`${apiUrl}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        ...init,
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) throw new Error(String(data.error ?? 'failed'))
      return data
    },
    [apiUrl],
  )

  /** Список и политика: `null` — не удалось (текст ошибки в `error`). */
  const fetchList = useCallback(
    () =>
      call('').then(
        (data) => ({ ok: true as const, data }),
        (e: Error) => ({ ok: false as const, message: e.message }),
      ),
    [call],
  )
  const apply = useCallback((r: Awaited<ReturnType<typeof fetchList>>) => {
    if (!r.ok) return setError(ERRORS[r.message] ?? 'Не удалось загрузить возвраты.')
    setRecent(r.data.recent as Refund[])
    setPolicy(r.data.policy as Policy)
    setAvailable(r.data.available === true)
  }, [])
  const reload = async () => apply(await fetchList())

  useEffect(() => {
    let alive = true
    void fetchList().then((r) => {
      if (alive) apply(r)
    })
    return () => {
      alive = false
    }
  }, [fetchList, apply])

  const findOrder = async (event?: FormEvent) => {
    event?.preventDefault()
    setError(null)
    setNotice(null)
    setConfirming(false)
    try {
      const data = (await call(
        `/order/${encodeURIComponent(orderNumber.trim().toUpperCase())}`,
      )) as unknown as OrderInfo
      setInfo(data)
      setSelected(new Set(data.tickets.filter((t) => t.status === 'ISSUED').map((t) => t.number)))
      setKey(newKey())
    } catch (e) {
      setInfo(null)
      setError(ERRORS[(e as Error).message] ?? 'Заказ не найден.')
    }
  }

  const issued = info?.tickets.filter((t) => t.status === 'ISSUED') ?? []
  const chosen = issued.filter((t) => selected.has(t.number))
  const whole = info !== null && info.tickets.length === 0 && info.order.status === 'NEEDS_REVIEW'
  const total = whole
    ? { cash: info!.order.cashKopecks, bonus: info!.order.bonusKopecks }
    : {
        cash: chosen.reduce((n, t) => n + t.cashKopecks + (includeFee ? t.feeKopecks : 0), 0),
        bonus: chosen.reduce((n, t) => n + t.bonusKopecks, 0),
      }

  const submit = async () => {
    if (!info) return
    setBusy(true)
    setError(null)
    try {
      const all = chosen.length === issued.length
      const data = await call('', {
        method: 'POST',
        body: JSON.stringify({
          orderNumber: info.order.number,
          // Все действующие билеты — полный возврат (пустой список).
          tickets: all ? [] : chosen.map((t) => t.number),
          reason,
          includeFee,
          clientKey: key,
        }),
      })
      const refund = data.refund as Refund
      setNotice(
        `Возврат ${formatRub(refund.cashKopecks)}: ${STATUS_LABEL[refund.status]}${data.duplicate ? ' (повтор того же запроса)' : ''}.`,
      )
      setConfirming(false)
      setReason('')
      await findOrder()
      await reload()
    } catch (e) {
      setError(ERRORS[(e as Error).message] ?? 'Возврат не оформлен.')
    } finally {
      setBusy(false)
    }
  }

  const retry = async (id: string) => {
    const why = window.prompt('Причина повтора запроса в банк')
    if (!why || why.trim().length < 3) return
    setBusy(true)
    try {
      const data = await call(`/${id}/retry`, {
        method: 'POST',
        body: JSON.stringify({ reason: why }),
      })
      setNotice(`Статус: ${STATUS_LABEL[(data.refund as Refund).status]}.`)
      await reload()
    } catch (e) {
      setError(ERRORS[(e as Error).message] ?? 'Не удалось повторить.')
    } finally {
      setBusy(false)
    }
  }

  const savePolicy = async (event: FormEvent) => {
    event.preventDefault()
    if (!policy) return
    setBusy(true)
    try {
      await call('/policy', { method: 'POST', body: JSON.stringify({ policy }) })
      setNotice('Политика возвратов сохранена.')
    } catch (e) {
      setError(ERRORS[(e as Error).message] ?? 'Политика не сохранена.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: '2rem', marginBottom: '3rem' }}>
      <h1>Возвраты</h1>
      {!available && (
        <p role="alert">
          Банк не подключён: вернуть деньги через сайт нельзя — только через кассу.
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--theme-error-500)' }}>
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}

      <section style={box} aria-label="Новый возврат">
        <h2>Новый возврат</h2>
        <form onSubmit={findOrder} style={{ display: 'flex', gap: '0.5rem', alignItems: 'end' }}>
          <label style={{ flex: 1 }}>
            Номер заказа
            <input
              style={input}
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="TRD-XXXXXXXX"
              required
            />
          </label>
          <Button type="submit" buttonStyle="secondary">
            Найти
          </Button>
        </form>

        {info && (
          <div style={{ marginTop: '1rem' }}>
            <p>
              Заказ <b>{info.order.number}</b> · {info.order.status}
              {info.order.guest ? ' · гость' : ''} · оплачено деньгами{' '}
              {formatRub(info.order.cashKopecks)}
              {info.order.bonusKopecks > 0 && `, бонусами ${formatRub(info.order.bonusKopecks)}`}
              {info.order.reviewReason && ` · причина проверки: ${info.order.reviewReason}`}
            </p>
            {info.tickets.length > 0 && (
              <table style={table}>
                <thead>
                  <tr>
                    <th style={cell}>Вернуть</th>
                    <th style={cell}>Билет</th>
                    <th style={cell}>Статус</th>
                    <th style={cell}>Деньгами</th>
                    <th style={cell}>Бонусами</th>
                    <th style={cell}>Сбор</th>
                  </tr>
                </thead>
                <tbody>
                  {info.tickets.map((t) => (
                    <tr key={t.number}>
                      <td style={cell}>
                        <input
                          type="checkbox"
                          aria-label={`Вернуть билет ${t.number}`}
                          disabled={t.status !== 'ISSUED'}
                          checked={selected.has(t.number)}
                          onChange={(e) => {
                            const next = new Set(selected)
                            if (e.target.checked) next.add(t.number)
                            else next.delete(t.number)
                            setSelected(next)
                            setConfirming(false)
                          }}
                        />
                      </td>
                      <td style={cell}>{t.number}</td>
                      <td style={cell}>{TICKET_LABEL[t.status]}</td>
                      <td style={cell}>{formatRub(t.cashKopecks)}</td>
                      <td style={cell}>{formatRub(t.bonusKopecks)}</td>
                      <td style={cell}>{formatRub(t.feeKopecks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(chosen.length > 0 || whole) && (
              <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                {!whole && (
                  <label>
                    <input
                      type="checkbox"
                      checked={includeFee}
                      onChange={(e) => {
                        setIncludeFee(e.target.checked)
                        setConfirming(false)
                      }}
                    />{' '}
                    Вернуть сервисный сбор
                  </label>
                )}
                <label>
                  Причина (обязательно, попадёт в журнал)
                  <textarea
                    style={input}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                    rows={2}
                    required
                  />
                </label>
                <p>
                  {whole
                    ? 'Заказ без билетов — возврат всего платежа.'
                    : chosen.length === issued.length
                      ? 'Полный возврат: все действующие билеты.'
                      : `Частичный возврат: ${chosen.length} из ${issued.length} билетов.`}{' '}
                  На карту: <b>{formatRub(total.cash)}</b>
                  {total.bonus > 0 && `, бонусами: ${formatRub(total.bonus)}`}. Начисленные за эти
                  билеты бонусы будут сторнированы.
                </p>
                {confirming ? (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <Button onClick={submit} disabled={busy}>
                      {busy ? 'Оформляем…' : `Подтвердить возврат ${formatRub(total.cash)}`}
                    </Button>
                    <Button buttonStyle="secondary" onClick={() => setConfirming(false)}>
                      Отмена
                    </Button>
                  </div>
                ) : (
                  <Button onClick={() => setConfirming(true)} disabled={reason.trim().length < 3}>
                    Оформить возврат
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section style={box} aria-label="Последние возвраты">
        <h2>Последние возвраты</h2>
        {recent.length === 0 ? (
          <p>Возвратов пока нет.</p>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={cell}>Когда</th>
                <th style={cell}>Заказ / билеты</th>
                <th style={cell}>Сумма</th>
                <th style={cell}>Статус</th>
                <th style={cell}>Кто и почему</th>
                <th style={cell} />
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td style={cell}>{time(r.createdAt)}</td>
                  <td style={cell}>
                    {r.orderNumber}
                    <br />
                    <small>{r.ticketNumbers.join(', ') || 'весь платёж'}</small>
                  </td>
                  <td style={cell}>
                    {formatRub(r.cashKopecks)}
                    {r.bonusKopecks > 0 && (
                      <>
                        <br />
                        <small>бонусами {formatRub(r.bonusKopecks)}</small>
                      </>
                    )}
                    {r.bonusReversalKopecks > 0 && (
                      <>
                        <br />
                        <small>сторно начисления {formatRub(r.bonusReversalKopecks)}</small>
                      </>
                    )}
                  </td>
                  <td style={cell}>
                    {STATUS_LABEL[r.status]}
                    {r.lastError && (
                      <>
                        <br />
                        <small>
                          банк: {r.lastError}, попыток {r.attempts}
                        </small>
                      </>
                    )}
                  </td>
                  <td style={cell}>
                    {r.requestedBy}
                    <br />
                    <small>{r.reason}</small>
                  </td>
                  <td style={cell}>
                    {(r.status === 'MANUAL_REVIEW' || r.status === 'REQUESTED') && (
                      <Button
                        buttonStyle="secondary"
                        size="small"
                        disabled={busy}
                        onClick={() => retry(r.id)}
                      >
                        Повторить запрос в банк
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {policy && (
        <section style={box} aria-label="Политика возвратов">
          <h2>Политика возвратов</h2>
          <p>
            <b>Значения — заглушки:</b> правила возврата театр ещё не утвердил (срок, частичный
            возврат, сервисный сбор, повторная продажа места). Возврат сотрудником работает всегда и
            не ограничен сроком.
          </p>
          <form onSubmit={savePolicy} style={{ display: 'grid', gap: '0.5rem' }}>
            <fieldset
              disabled={!canEditPolicy || busy}
              style={{ border: 0, padding: 0, display: 'grid', gap: '0.5rem' }}
            >
              <label>
                <input
                  type="checkbox"
                  checked={policy.customerRefundsEnabled}
                  onChange={(e) =>
                    setPolicy({ ...policy, customerRefundsEnabled: e.target.checked })
                  }
                />{' '}
                Возврат в личном кабинете (выключено — «через кассу театра / по почте»)
              </label>
              <label>
                Не позже чем за, часов до начала
                <input
                  style={{ ...input, maxWidth: '10rem' }}
                  type="number"
                  min={0}
                  max={2160}
                  value={policy.deadlineHoursBeforeStart}
                  onChange={(e) =>
                    setPolicy({ ...policy, deadlineHoursBeforeStart: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={policy.allowPartial}
                  onChange={(e) => setPolicy({ ...policy, allowPartial: e.target.checked })}
                />{' '}
                Зритель может вернуть часть билетов заказа
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={policy.refundServiceFee}
                  onChange={(e) => setPolicy({ ...policy, refundServiceFee: e.target.checked })}
                />{' '}
                Возвращать сервисный сбор зрителю
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={policy.returnToSale}
                  onChange={(e) => setPolicy({ ...policy, returnToSale: e.target.checked })}
                />{' '}
                Возвращённое место снова в продаже
              </label>
            </fieldset>
            {canEditPolicy ? (
              <Button type="submit" disabled={busy}>
                Сохранить политику
              </Button>
            ) : (
              <p>Менять политику может администратор театра.</p>
            )}
          </form>
        </section>
      )}
    </div>
  )
}
