'use client'

import { Button } from '@payloadcms/ui'
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { formatRub } from '@/lib/money'
import { useAdminDialog } from '../AdminDialog'
import { CLAIMS_COUNT_EVENT } from './RefundClaimsQueue'
import s from './refunds.module.css'

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
  halfPercent: number
  lowPercent: number
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

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' }) : '—'
const newKey = () => crypto.randomUUID()

type RefundsPanelProps = {
  apiUrl: string
  canEditPolicy: boolean
  /** Очередь заявок зрителей — первая вкладка. */
  claims?: ReactNode
}

const TABS = [
  { id: 'claims', label: 'Заявки' },
  { id: 'new', label: 'Новый возврат' },
  { id: 'recent', label: 'Последние возвраты' },
  { id: 'policy', label: 'Политика' },
] as const
type Tab = (typeof TABS)[number]['id']

function RefundsPanelView({
  apiUrl,
  canEditPolicy,
  claims,
  dialog,
}: RefundsPanelProps & { dialog: AdminDialog }) {
  const [recent, setRecent] = useState<Refund[]>([])
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [tab, setTab] = useState<Tab>(claims ? 'claims' : 'new')
  // Счётчик открытых заявок на вкладке — его сообщает очередь после загрузки.
  const [openClaims, setOpenClaims] = useState(0)
  useEffect(() => {
    const onCount = (e: Event) => setOpenClaims(Number((e as CustomEvent<number>).detail) || 0)
    window.addEventListener(CLAIMS_COUNT_EVENT, onCount)
    return () => window.removeEventListener(CLAIMS_COUNT_EVENT, onCount)
  }, [])
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
    const why = await dialog.prompt({
      title: 'Повторить запрос в банк?',
      label: 'Причина повтора',
      placeholder: 'Например: банк не ответил',
      minLength: 3,
      confirmLabel: 'Повторить',
    })
    if (!why) return
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
    <div className={s.root}>
      <h1>Возвраты</h1>
      {!available && (
        <p role="alert">
          Банк не подключён: вернуть деньги через сайт нельзя — только через кассу.
        </p>
      )}
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

      <div
        role="tablist"
        aria-label="Разделы возвратов"
        className={s.tabs}
        onKeyDown={(e) => {
          // Стрелки переключают вкладки (паттерн WAI-ARIA Tabs).
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
          const i = TABS.findIndex((t) => t.id === tab)
          const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!
          setTab(next.id)
          document.getElementById(`refunds-tab-${next.id}`)?.focus()
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`refunds-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`refunds-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={s.tab}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'claims' && openClaims > 0 && (
              <span className={s.count} aria-label={`${openClaims} на рассмотрении`}>
                {openClaims}
              </span>
            )}
          </button>
        ))}
      </div>

      <div
        id="refunds-panel-claims"
        role="tabpanel"
        aria-labelledby="refunds-tab-claims"
        hidden={tab !== 'claims'}
      >
        {claims}
      </div>

      <section
        id="refunds-panel-new"
        role="tabpanel"
        aria-labelledby="refunds-tab-new"
        hidden={tab !== 'new'}
        className={s.card}
      >
        <form onSubmit={findOrder} className={s.row}>
          <label className={s.grow}>
            Номер заказа
            <input
              className={s.input}
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
          <div className={s.section}>
            <p>
              Заказ <b>{info.order.number}</b> · {info.order.status}
              {info.order.guest ? ' · гость' : ''} · оплачено деньгами{' '}
              {formatRub(info.order.cashKopecks)}
              {info.order.bonusKopecks > 0 && `, бонусами ${formatRub(info.order.bonusKopecks)}`}
              {info.order.reviewReason && ` · причина проверки: ${info.order.reviewReason}`}
            </p>
            {info.tickets.length > 0 && (
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Вернуть</th>
                    <th>Билет</th>
                    <th>Статус</th>
                    <th>Деньгами</th>
                    <th>Бонусами</th>
                    <th>Сбор</th>
                  </tr>
                </thead>
                <tbody>
                  {info.tickets.map((t) => (
                    <tr key={t.number}>
                      <td>
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
                      <td>{t.number}</td>
                      <td>{TICKET_LABEL[t.status]}</td>
                      <td>{formatRub(t.cashKopecks)}</td>
                      <td>{formatRub(t.bonusKopecks)}</td>
                      <td>{formatRub(t.feeKopecks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(chosen.length > 0 || whole) && (
              <div className={s.section}>
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
                    className={s.input}
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
                  <div className={s.row}>
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

      <section
        id="refunds-panel-recent"
        role="tabpanel"
        aria-labelledby="refunds-tab-recent"
        hidden={tab !== 'recent'}
        className={s.card}
      >
        {recent.length === 0 ? (
          <p>Возвратов пока нет.</p>
        ) : (
          <table className={s.table}>
            <thead>
              <tr>
                <th>Когда</th>
                <th>Заказ / билеты</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th>Кто и почему</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td>{time(r.createdAt)}</td>
                  <td>
                    {r.orderNumber}
                    <br />
                    <small>{r.ticketNumbers.join(', ') || 'весь платёж'}</small>
                  </td>
                  <td>
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
                  <td>
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
                  <td>
                    {r.requestedBy}
                    <br />
                    <small>{r.reason}</small>
                  </td>
                  <td>
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
        <section
          id="refunds-panel-policy"
          role="tabpanel"
          aria-labelledby="refunds-tab-policy"
          hidden={tab !== 'policy'}
          className={s.card}
        >
          <p>
            Зритель подаёт заявку в личном кабинете, решение принимает сотрудник (вкладка «Заявки»).
            Проценты — от номинала билета без сервисного сбора; ниже минимума закона их не опустить.
            Сбор возвращается только при переносе, отмене или замене спектакля.
          </p>
          <form onSubmit={savePolicy} className={s.stack}>
            <fieldset disabled={!canEditPolicy || busy} className={s.fieldset}>
              <p className={s.flush}>Больше 10 дней до спектакля — 100% (по закону).</p>
              <label>
                От 5 до 10 дней, % (не меньше 50)
                <input
                  className={`${s.input} ${s.inputShort}`}
                  type="number"
                  min={50}
                  max={100}
                  value={policy.halfPercent}
                  onChange={(e) => setPolicy({ ...policy, halfPercent: Number(e.target.value) })}
                />
              </label>
              <label>
                От 3 до 5 дней, % (не меньше 30)
                <input
                  className={`${s.input} ${s.inputShort}`}
                  type="number"
                  min={30}
                  max={100}
                  value={policy.lowPercent}
                  onChange={(e) => setPolicy({ ...policy, lowPercent: Number(e.target.value) })}
                />
              </label>
              <p className={s.flush}>
                Меньше 3 дней — только болезнь зрителя или смерть близкого, с документом (до 14 дней
                после спектакля).
              </p>
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

type AdminDialog = ReturnType<typeof useAdminDialog>

export function RefundsPanel(props: RefundsPanelProps) {
  const dialog = useAdminDialog()
  return (
    <>
      {dialog.element}
      <RefundsPanelView {...props} dialog={dialog} />
    </>
  )
}
