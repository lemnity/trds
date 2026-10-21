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
import { useState, type FormEvent } from 'react'

import {
  LEAD_FORMATS,
  leadMailBody,
  parseLead,
  type LeadErrors,
  type LeadFormat,
} from '@/modules/leads'

import { InlineNotice } from '../ui/InlineNotice'
import styles from './Corporate.module.css'

type Props = { email: string; manager: { handle: string; href: string } }

/**
 * Заявка на корпоратив (T-034). До `POST /api/leads` (сохранение, журнал согласия, канбан
 * T-065) заявка уходит письмом: после проверки открывается почта с готовым текстом.
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
  const [sent, setSent] = useState<string | null>(null)

  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => {
    setV((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => ({
      ...prev,
      [key]: undefined,
      ...(key === 'phone' && { email: undefined }),
    }))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = parseLead(v, new Date())
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    const subject = `Заявка на корпоратив — ${result.value.name}`
    const href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(leadMailBody(result.value))}`
    setSent(href)
    window.location.href = href
  }

  if (sent)
    return (
      <div className={styles.form} role="status">
        <InlineNotice tone="info" title="Письмо с заявкой готово">
          Открылась почтовая программа с заполненным письмом театру — отправьте его. Если почта не
          открылась, напишите на {email} или руководителю в Telegram {manager.handle}.
        </InlineNotice>
        <div className={styles.sentActions}>
          <a href={sent} className={styles.linkButton}>
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

      <Button type="submit" fullWidth className={styles.submit}>
        Отправить заявку
      </Button>
      <p className={styles.hint}>
        Заявка уйдёт письмом театру: откроется ваша почта с готовым текстом.
      </p>
    </form>
  )
}
