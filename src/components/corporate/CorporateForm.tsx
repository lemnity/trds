'use client'

import {
  Button,
  Checkbox,
  FieldError,
  Input,
  Label,
  Radio,
  RadioGroup,
  TextArea,
  TextField,
} from '@heroui/react'
import Link from 'next/link'
import { useRef, useState, type FormEvent } from 'react'

import {
  LEAD_FORMATS,
  leadMailBody,
  parseLead,
  type LeadErrors,
  type LeadFormat,
} from '@/modules/leads'

import { postJson } from '../auth/api'
import { IS_STATIC_PREVIEW } from '../auth/session'
import { InlineNotice } from '../ui/InlineNotice'
import styles from './Corporate.module.css'

type Props = { email: string; manager: { handle: string; href: string } }

/** Ключ отправки: один на одно содержимое формы — повтор после сбоя не создаст вторую заявку. */
const newSubmissionKey = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // randomUUID есть только на https и localhost; запасной путь — те же 16 случайных байт.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

type Sent = { kind: 'server' } | { kind: 'mail'; href: string }

/**
 * Заявка на корпоратив (T-034, PRD §5.7). На сервере — `POST /api/leads`: заявка сохраняется
 * со статусом «Новая», согласие — в журнал. Ключ отправки живёт, пока не изменились поля:
 * повторное нажатие после ошибки сети не создаёт дубль. На статическом превью (сервера нет) —
 * письмо театру с готовым текстом (mailto); при сбое сервера письмо предлагается запасным путём.
 */
export function CorporateForm({ email, manager }: Props) {
  const [v, setV] = useState({
    name: '',
    email: '',
    phone: '',
    date: '',
    guests: '',
    format: 'corporate' as LeadFormat,
    budget: '',
    comment: '',
    consent: false,
  })
  const [errors, setErrors] = useState<LeadErrors>({})
  const [sent, setSent] = useState<Sent | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ text: string; mail: string | null } | null>(null)
  const submissionKey = useRef<string | null>(null)

  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => {
    // Другое содержимое — другая заявка: следующий «Отправить» получит новый ключ.
    submissionKey.current = null
    setProblem(null)
    setV((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => ({
      ...prev,
      [key]: undefined,
      ...(key === 'phone' && { email: undefined }),
    }))
  }

  const mailHref = (lead: Parameters<typeof leadMailBody>[0]) =>
    `mailto:${email}?subject=${encodeURIComponent(`Заявка на корпоратив — ${lead.name}`)}&body=${encodeURIComponent(leadMailBody(lead))}`

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setProblem(null)
    const result = parseLead(v, new Date())
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    if (IS_STATIC_PREVIEW) {
      // Превью без сервера: заявку некуда сохранить — открываем письмо театру.
      const href = mailHref(result.value)
      setSent({ kind: 'mail', href })
      window.location.href = href
      return
    }
    submissionKey.current ??= newSubmissionKey()
    setBusy(true)
    const { status, data } = await postJson<{ error?: string; fields?: LeadErrors }>('/api/leads', {
      idempotencyKey: submissionKey.current,
      lead: v,
    })
    setBusy(false)
    if (status === 200 || status === 201) {
      submissionKey.current = null
      setSent({ kind: 'server' })
      return
    }
    if (status === 400 && data?.fields) {
      setErrors(data.fields)
      return
    }
    if (status === 409) {
      // Ключ уже занят другим содержимым — следующая попытка уйдёт с новым.
      submissionKey.current = null
      setProblem({
        text: 'Заявка изменилась во время отправки. Нажмите «Отправить заявку» ещё раз.',
        mail: null,
      })
      return
    }
    const mail = mailHref(result.value)
    setProblem({
      text:
        status === 429
          ? 'Слишком много заявок подряд. Попробуйте через 10 минут или отправьте заявку письмом.'
          : 'Нет связи с сервером. Попробуйте ещё раз — повторная отправка не создаст дубль. Или отправьте заявку письмом.',
      mail,
    })
  }

  // Новая заявка: контакты оставляем, детали события — сначала.
  const reset = () => {
    setV((prev) => ({ ...prev, date: '', guests: '', budget: '', comment: '', consent: false }))
    setSent(null)
  }

  if (sent?.kind === 'server')
    return (
      <div className={styles.form} role="status">
        <InlineNotice tone="info" title="Заявка принята">
          Театр получил заявку и свяжется с вами по указанным контактам. Если хотите что-то уточнить
          сразу — напишите на {email} или руководителю в Telegram {manager.handle}.
        </InlineNotice>
        <div className={styles.sentActions}>
          <button type="button" className={styles.linkButton} onClick={reset}>
            Отправить ещё одну заявку
          </button>
        </div>
      </div>
    )

  if (sent?.kind === 'mail')
    return (
      <div className={styles.form} role="status">
        <InlineNotice tone="info" title="Письмо с заявкой готово">
          Открылась почтовая программа с заполненным письмом театру — отправьте его. Если почта не
          открылась, напишите на {email} или руководителю в Telegram {manager.handle}.
        </InlineNotice>
        <div className={styles.sentActions}>
          <a href={sent.href} className={styles.linkButton}>
            Открыть письмо ещё раз
          </a>
          <button type="button" className={styles.linkButton} onClick={() => setSent(null)}>
            Изменить заявку
          </button>
        </div>
      </div>
    )

  const field = (
    key: 'name' | 'email' | 'phone' | 'date' | 'guests' | 'budget',
    label: string,
    extra: Partial<{
      type: string
      inputMode: 'email' | 'tel' | 'numeric'
      autoComplete: string
      placeholder: string
      required: boolean
    }> = {},
  ) => (
    <TextField
      type={extra.type ?? 'text'}
      inputMode={extra.inputMode}
      autoComplete={extra.autoComplete}
      value={v[key]}
      onChange={(value) => set(key, value)}
      isRequired={extra.required}
      isInvalid={Boolean(errors[key])}
      validationBehavior="aria"
    >
      <Label>{label}</Label>
      <Input placeholder={extra.placeholder} />
      <FieldError>{errors[key]}</FieldError>
    </TextField>
  )

  return (
    <form className={styles.form} onSubmit={submit} noValidate aria-label="Заявка на корпоратив">
      <RadioGroup
        value={v.format}
        onChange={(value) => set('format', value as LeadFormat)}
        orientation="horizontal"
        className={styles.formats}
      >
        <Label className={styles.legend}>Что планируете</Label>
        <div className={styles.chips}>
          {LEAD_FORMATS.map((f) => (
            <Radio key={f.id} value={f.id} className={styles.chip}>
              <Radio.Content className={styles.chipBody}>
                <Radio.Control className={styles.chipControl}>
                  <Radio.Indicator />
                </Radio.Control>
                <Label>{f.label}</Label>
              </Radio.Content>
            </Radio>
          ))}
        </div>
      </RadioGroup>

      {field('name', 'Имя', {
        autoComplete: 'name',
        placeholder: 'Как к вам обращаться',
        required: true,
      })}
      <div className={styles.row}>
        {field('email', 'E-mail', {
          type: 'email',
          inputMode: 'email',
          autoComplete: 'email',
          placeholder: 'you@company.ru',
        })}
        {field('phone', 'Телефон', {
          type: 'tel',
          inputMode: 'tel',
          autoComplete: 'tel',
          placeholder: '+7 ___ ___-__-__',
        })}
      </div>
      <p className={styles.hint}>Почта или телефон — чтобы мы ответили.</p>
      <div className={styles.row}>
        {field('date', 'Дата события', { type: 'date' })}
        {field('guests', 'Гостей', { inputMode: 'numeric', placeholder: 'Например, 40' })}
      </div>
      {field('budget', 'Бюджет', { placeholder: 'Если уже понятен' })}
      <TextField
        value={v.comment}
        onChange={(value) => set('comment', value)}
        isInvalid={Boolean(errors.comment)}
        validationBehavior="aria"
      >
        <Label>Комментарий</Label>
        <TextArea rows={4} placeholder="Площадка, повод, пожелания к спектаклю" />
        <FieldError>{errors.comment}</FieldError>
      </TextField>

      <Checkbox
        isSelected={v.consent}
        onChange={(value) => set('consent', value)}
        isRequired
        isInvalid={Boolean(errors.consent)}
        validationBehavior="aria"
      >
        <Checkbox.Content>
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Label>Согласен на обработку персональных данных для ответа на заявку</Label>
        </Checkbox.Content>
        <FieldError>{errors.consent}</FieldError>
      </Checkbox>
      <p className={styles.hint}>
        <Link href="/documents/personal-data" target="_blank" rel="noopener">
          Как мы обрабатываем персональные данные
        </Link>
      </p>

      {problem && (
        <InlineNotice tone="danger" title="Заявка не отправлена">
          {problem.text}
          {problem.mail && (
            <>
              {' '}
              <a href={problem.mail}>Отправить письмом</a>
            </>
          )}
        </InlineNotice>
      )}
      <Button type="submit" fullWidth className={styles.submit} isPending={busy}>
        {busy ? 'Отправляем…' : 'Отправить заявку'}
      </Button>
      <p className={styles.hint}>
        {IS_STATIC_PREVIEW
          ? 'Заявка уйдёт письмом театру: откроется ваша почта с готовым текстом.'
          : 'Заявка придёт театру — вам ответят по почте или телефону из заявки.'}
      </p>
    </form>
  )
}
