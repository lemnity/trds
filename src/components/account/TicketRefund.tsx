'use client'

import { buttonVariants } from '@heroui/styles'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Button } from 'react-aria-components'

import { formatRub } from '@/lib/money'

import { postJson } from '../auth/api'
import styles from './Tickets.module.css'
import { formatTicketDate } from './tickets-view'
import { reloadTickets } from './useAccountTickets'

/**
 * Возврат билета из кабинета — заявка (ст. 52.1 Закона о культуре, ПП № 1491). Зритель выбирает
 * причину, видит, что положено по закону (процент, сумму, нужен ли документ, сроки), и подаёт
 * заявку; деньги возвращаются после решения театра. Документ (больничный, свидетельство) можно
 * приложить сразу или прислать позже — до 14 дней после спектакля. Решает только сервер.
 */

type Reason = 'CHANGED_MIND' | 'ILLNESS' | 'RELATIVE_DEATH' | 'EVENT_CHANGED' | 'OTHER'

const REASONS: { value: Reason; label: string }[] = [
  { value: 'CHANGED_MIND', label: 'Не смогу пойти / передумал' },
  { value: 'ILLNESS', label: 'Болезнь' },
  { value: 'RELATIVE_DEATH', label: 'Смерть близкого родственника' },
  { value: 'EVENT_CHANGED', label: 'Спектакль перенесён, отменён или заменён' },
  { value: 'OTHER', label: 'Другая причина' },
]

type Quote = {
  ticketNumbers: string[]
  percent: number
  basisText: string
  canSubmit: boolean
  documentRequired: boolean
  documentDeadline: string | null
  submitDeadline: string
  amounts: { cashKopecks: number; bonusKopecks: number; feeKopecks: number }
  feeKeptKopecks: number
}

type Claim = {
  id: string
  number: string
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  ticketNumbers: string[]
  reasonLabel: string
  legalPercent: number
  documentRequired: boolean
  filesUntil: string
  files: { id: string; name: string }[]
  decidedPercent: number | null
  decisionComment: string | null
  createdAt: string
}

type State =
  | { step: 'idle' }
  | { step: 'loading' }
  | { step: 'form' }
  | { step: 'claim'; claim: Claim }
  | { step: 'error'; message: string }

const ERROR_TEXT: Record<string, string> = {
  already_claimed: 'По этому билету уже есть заявка на возврат.',
  too_late: 'Заявку на возврат можно подать не позже дня спектакля.',
  not_refundable: 'Этот билет вернуть нельзя: он уже возвращается или недействителен.',
  too_many: 'Слишком много попыток. Подождите несколько минут.',
  unauthorized: 'Войдите в личный кабинет заново.',
}

const DEMO_TEXT =
  'Демо: на сайте театра здесь откроется заявка на возврат — причина, сумма по закону и документы.'

const when = (iso: string) => {
  const d = formatTicketDate(iso)
  return d ? `${d.date}${d.time ? `, ${d.time}` : ''}` : iso
}

function ClaimStatus({ claim, onChange }: { claim: Claim; onChange: (c: Claim) => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const open = claim.status === 'SUBMITTED'
  // Время открытия блока: срок для документов проверяет и сервер, здесь — только кнопка.
  const [openedAt] = useState(() => Date.now())
  const canUpload = open && new Date(claim.filesUntil).getTime() > openedAt

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setMessage(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/account/refund-claims/${claim.id}/files`, {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      })
      const data = (await res.json().catch(() => null)) as {
        file?: { id: string; name: string }
        message?: string
      } | null
      if (res.ok && data?.file) {
        onChange({ ...claim, files: [...claim.files, data.file] })
        setMessage('Документ получен.')
      } else setMessage(data?.message ?? 'Не удалось загрузить файл. Повторите.')
    } catch {
      setMessage('Нет связи. Проверьте интернет и повторите.')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    setBusy(true)
    const { data } = await postJson<{ claim?: Claim }>(
      `/api/account/refund-claims/${claim.id}/cancel`,
      {},
    )
    setBusy(false)
    if (data?.claim) onChange(data.claim)
    else setMessage('Не удалось отозвать заявку. Повторите.')
  }

  return (
    <div className={styles.refund} role="status">
      <p className={styles.refundTitle}>Заявка на возврат {claim.number}</p>
      {claim.status === 'SUBMITTED' && (
        <p>
          На рассмотрении. Причина: {claim.reasonLabel.toLowerCase()}. Мы напишем, когда театр
          примет решение; билет действует, пока заявка не одобрена.
        </p>
      )}
      {claim.status === 'APPROVED' && (
        <p>
          Одобрена: возвращаем {claim.decidedPercent}% стоимости. Деньги поступят на карту, с
          которой оплачен заказ; срок зачисления зависит от вашего банка.
        </p>
      )}
      {claim.status === 'REJECTED' && (
        <p>
          В возврате отказано.{claim.decisionComment ? ` ${claim.decisionComment}` : ''} Билет
          действует — его можно передать другому человеку.
        </p>
      )}
      {claim.status === 'CANCELLED' && <p>Заявка отозвана, билет действует.</p>}

      {(claim.documentRequired || claim.files.length > 0) && open && (
        <div className={styles.refundNote}>
          {claim.files.length > 0 ? (
            <p>Документы: {claim.files.map((f) => f.name).join(', ')}.</p>
          ) : (
            <p>
              Приложите подтверждающий документ (больничный лист, справку, свидетельство) — до{' '}
              {when(claim.filesUntil)}.
            </p>
          )}
        </div>
      )}
      {canUpload && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/heic,image/webp"
            hidden
            onChange={upload}
          />
          <Button
            className={buttonVariants({ variant: 'outline' })}
            isDisabled={busy}
            onPress={() => fileRef.current?.click()}
          >
            {busy ? 'Загружаем…' : 'Приложить документ'}
          </Button>
        </>
      )}
      {open && (
        <Button
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          isDisabled={busy}
          onPress={cancel}
        >
          Отозвать заявку
        </Button>
      )}
      {message && <p className={styles.refundNote}>{message}</p>}
    </div>
  )
}

/**
 * `autoStart` — сразу показать заявку или форму (кнопка «Вернуть» на карточке билета);
 * `demo` — на превью сервера нет, показываем честную пометку вместо запроса.
 */
export function TicketRefund({
  ticketNumber,
  autoStart = false,
  demo = false,
}: {
  ticketNumber: string
  autoStart?: boolean
  demo?: boolean
}) {
  const [state, setState] = useState<State>(() =>
    autoStart
      ? demo
        ? { step: 'error', message: DEMO_TEXT }
        : { step: 'loading' }
      : { step: 'idle' },
  )
  const [reason, setReason] = useState<Reason | null>(null)
  const [comment, setComment] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [sending, setSending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Список билетов обновляем, когда блок закрыт: так зритель видит результат до перерисовки.
  const changed = useRef(false)
  useEffect(
    () => () => {
      if (changed.current) void reloadTickets()
    },
    [],
  )

  /** Есть ли уже заявка по билету: открытая — показываем её, иначе — форма. */
  const fetchExisting = async () => {
    try {
      const res = await fetch('/api/account/refund-claims', {
        cache: 'no-store',
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error(String(res.status))
      const { claims } = (await res.json()) as { claims: Claim[] }
      const mine = claims.find(
        (c) => c.ticketNumbers.includes(ticketNumber) && c.status === 'SUBMITTED',
      )
      setState(mine ? { step: 'claim', claim: mine } : { step: 'form' })
    } catch {
      setState({ step: 'error', message: 'Не удалось открыть возврат. Повторите позже.' })
    }
  }

  const start = () => {
    if (demo) {
      setState({ step: 'error', message: DEMO_TEXT })
      return
    }
    setState({ step: 'loading' })
    void fetchExisting()
  }

  const started = useRef(false)
  useEffect(() => {
    if (!autoStart || demo || started.current) return
    started.current = true
    void fetchExisting()
    // fetchExisting читает только ticketNumber; повторный запуск не нужен.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const choose = async (r: Reason) => {
    setReason(r)
    setQuote(null)
    setFormError(null)
    try {
      const res = await fetch(
        `/api/account/refund-claims/quote?tickets=${encodeURIComponent(ticketNumber)}&reason=${r}`,
        { cache: 'no-store', credentials: 'same-origin' },
      )
      if (!res.ok) throw new Error(String(res.status))
      setQuote((await res.json()) as Quote)
    } catch {
      setFormError('Не удалось посчитать возврат. Повторите позже.')
    }
  }

  const submit = async () => {
    if (!reason) return
    setSending(true)
    setFormError(null)
    const { status, data } = await postJson<{ claim?: Claim; error?: string; message?: string }>(
      '/api/account/refund-claims',
      { tickets: [ticketNumber], reason, comment: comment.trim() || null },
    )
    setSending(false)
    if (data?.claim) {
      changed.current = true
      setState({ step: 'claim', claim: data.claim })
      return
    }
    setFormError(
      (data?.error && ERROR_TEXT[data.error]) ||
        data?.message ||
        (status === 0 ? 'Нет связи. Проверьте интернет и повторите.' : 'Заявка не отправлена.'),
    )
  }

  if (state.step === 'idle')
    return (
      <Button className={buttonVariants({ variant: 'outline' })} onPress={start}>
        Вернуть билет
      </Button>
    )
  if (state.step === 'loading')
    return (
      <p className={styles.refund} role="status">
        Открываем возврат…
      </p>
    )
  if (state.step === 'error')
    return (
      <div className={styles.refund} role="alert">
        <p>{state.message}</p>
      </div>
    )
  if (state.step === 'claim')
    return (
      <ClaimStatus
        claim={state.claim}
        onChange={(c) => {
          changed.current = true
          setState({ step: 'claim', claim: c })
        }}
      />
    )

  return (
    <section className={styles.refund} aria-label="Заявка на возврат">
      <p className={styles.refundTitle}>Заявка на возврат</p>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '0.4rem' }}>
        <legend style={{ marginBottom: '0.4rem' }}>Почему возвращаете билет?</legend>
        {REASONS.map((r) => (
          <label key={r.value} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="radio"
              name={`refund-reason-${ticketNumber}`}
              checked={reason === r.value}
              onChange={() => void choose(r.value)}
            />
            {r.label}
          </label>
        ))}
      </fieldset>

      {quote && (
        <>
          <p className={styles.refundNote}>{quote.basisText}</p>
          {quote.canSubmit && quote.percent > 0 && (
            <dl className={styles.orderSum}>
              <div>
                <dt>По закону вернётся на карту ({quote.percent}%)</dt>
                <dd>{formatRub(quote.amounts.cashKopecks)}</dd>
              </div>
              {quote.amounts.bonusKopecks > 0 && (
                <div>
                  <dt>Вернётся бонусами</dt>
                  <dd>{formatRub(quote.amounts.bonusKopecks)}</dd>
                </div>
              )}
              {quote.feeKeptKopecks > 0 && (
                <div>
                  <dt>Сервисный сбор не возвращается</dt>
                  <dd>{formatRub(quote.feeKeptKopecks)}</dd>
                </div>
              )}
            </dl>
          )}
          {quote.documentRequired && quote.documentDeadline && (
            <p className={styles.refundNote}>
              Понадобится подтверждающий документ — его можно приложить после подачи заявки, до{' '}
              {when(quote.documentDeadline)}.
            </p>
          )}
          {!quote.canSubmit && (
            <p className={styles.refundNote}>
              Заявку можно было подать до {when(quote.submitDeadline)} — срок прошёл.
            </p>
          )}
        </>
      )}

      {quote?.canSubmit && (
        <>
          <label style={{ display: 'grid', gap: '0.3rem' }}>
            Комментарий (необязательно)
            <textarea
              rows={3}
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              style={{ font: 'inherit', padding: '0.5rem', resize: 'vertical' }}
            />
          </label>
          <p className={styles.refundNote}>
            Заявку рассмотрит театр. Пока её не одобрят, билет действует; после возврата —
            перестанет.
          </p>
          <Button
            className={buttonVariants({ variant: 'danger' })}
            isDisabled={sending}
            onPress={submit}
          >
            {sending ? 'Отправляем…' : 'Отправить заявку'}
          </Button>
        </>
      )}
      {formError && (
        <p className={styles.refundNote} role="alert">
          {formError}
        </p>
      )}
      <Button
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        isDisabled={sending}
        onPress={() => setState({ step: 'idle' })}
      >
        Отмена
      </Button>
    </section>
  )
}
