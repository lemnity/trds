'use client'

import { Button, Description, FieldError, Input, Label, TextField } from '@heroui/react'
import { useState, type FormEvent } from 'react'

import { formatRub } from '@/lib/money'
import { parseCertificateCode } from '@/modules/loyalty'

import { reveal } from '../ui/reveal'
import styles from './Account.module.css'
import { DemoBadge } from './BonusSection'
import {
  activationErrorText,
  activationSuccessText,
  certificateInputError,
  formatCertificateInput,
  formatDate,
} from './loyalty-view'
import { activateCertificate, useLoyalty } from './useLoyalty'

/**
 * Раздел «Сертификат» (PRD §5.8): номер подарочного сертификата → номинал на бонусный баланс.
 * Формат и контрольный символ проверяются сразу в браузере; найден ли сертификат — решает сервер.
 */
export function CertificateSection() {
  const loyalty = useLoyalty()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState('')

  const data = loyalty.status === 'ready' ? loyalty.data : null
  const demo = loyalty.status === 'ready' && loyalty.demo
  const canActivate = loyalty.status === 'ready'

  const onChange = (next: string) => {
    const masked = formatCertificateInput(next)
    setValue(masked)
    setSuccess('')
    // При наборе — только явные ошибки (чужой символ, опечатка в полном номере).
    setError(certificateInputError(masked))
  }

  const onBlur = () => {
    const parsed = parseCertificateCode(value)
    if (parsed.ok) setValue(parsed.code)
    else if (value) setError(certificateInputError(value, true))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !canActivate) return
    const invalid = certificateInputError(value, true)
    if (invalid) {
      setError(invalid)
      document.getElementById('certificate-code')?.focus()
      return
    }
    const parsed = parseCertificateCode(value)
    if (!parsed.ok) return
    setBusy(true)
    setError(null)
    setSuccess('')
    const result = await activateCertificate(parsed.code)
    setBusy(false)
    if (result.ok) {
      setValue('')
      setSuccess(activationSuccessText(result.amountKopecks, result.expiresAt))
    } else {
      setError(activationErrorText(result.status, result.error))
      document.getElementById('certificate-code')?.focus()
    }
  }

  return (
    <div className={styles.certGrid}>
      <div className={styles.card} {...reveal(1)}>
        <p className={styles.cardLabel}>Активировать {demo && <DemoBadge />}</p>
        <p className={styles.cardText}>
          Номинал сертификата зачислим на бонусный баланс — им можно оплатить билеты. Бонусы за
          сертификаты не начисляются.
        </p>
        <form className={styles.form} onSubmit={submit} noValidate>
          <TextField
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            autoComplete="off"
            inputMode="text"
            isRequired
            isInvalid={Boolean(error)}
            isDisabled={!canActivate}
            validationBehavior="aria"
            className={styles.code}
          >
            <Label>Номер сертификата</Label>
            <Input
              id="certificate-code"
              placeholder="TRDS-XXXX-XXXX-XXXX"
              spellCheck={false}
              autoCapitalize="characters"
              autoCorrect="off"
              maxLength={19}
            />
            {error ? (
              <FieldError>{error}</FieldError>
            ) : (
              <Description>
                {loyalty.status === 'guest'
                  ? 'Войдите, чтобы активировать сертификат.'
                  : 'Номер напечатан на сертификате или пришёл в письме. Регистр и дефисы не важны.'}
              </Description>
            )}
          </TextField>
          <Button
            type="submit"
            className={styles.submit}
            isPending={busy}
            isDisabled={!canActivate || busy}
          >
            {busy ? 'Проверяем…' : 'Активировать'}
          </Button>
          <p className={styles.success} role="status" aria-live="polite">
            {success}
          </p>
        </form>
      </div>
      <div className={styles.card} {...reveal(2)}>
        <p className={styles.cardLabel}>Активированные</p>
        {data && data.certificates.length > 0 ? (
          <ul className={styles.certs}>
            {data.certificates.map((c) => (
              <li key={`${c.serial}-${c.last4}`}>
                <span>
                  {c.serial} · ••••{c.last4}
                </span>
                <b>{formatRub(c.amountKopecks)}</b>
                <small>
                  Активирован {formatDate(c.activatedAt)} · действует до {formatDate(c.expiresAt)}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.cardText}>
            {loyalty.status === 'loading' ? 'Загружаем…' : 'Активированных сертификатов пока нет.'}
          </p>
        )}
      </div>
    </div>
  )
}
