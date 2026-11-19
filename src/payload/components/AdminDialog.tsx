'use client'

import { Button } from '@payloadcms/ui'
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Окна подтверждения и ввода в стиле админки — вместо системных window.confirm / window.prompt.
 * Нативный <dialog> (showModal): фокус внутри окна, Esc закрывает, фон затемнён. Цвета — из темы
 * Payload, поэтому окно одинаково выглядит в светлой и тёмной теме.
 *
 *   const dialog = useAdminDialog()
 *   if (!(await dialog.confirm({ title: 'Выпустить сертификаты?' }))) return
 *   const reason = await dialog.prompt({ title: 'Причина', minLength: 3 })
 *   return <>{dialog.element}…</>
 *
 * Окно рендерится порталом в document.body: хук часто вызывают внутри формы документа Payload, а
 * вложенный <form> недопустим — Enter и «Подтвердить» отправили бы форму документа. Порталы
 * пропускают события React вверх по дереву компонентов, поэтому submit окна ещё и останавливается.
 */

type ConfirmOptions = {
  title: string
  body?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Опасное действие — кнопка подтверждения красная. */
  danger?: boolean
}

type PromptOptions = ConfirmOptions & {
  label?: string
  placeholder?: string
  minLength?: number
}

type Pending =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }

const box: React.CSSProperties = {
  width: 'min(440px, calc(100vw - 32px))',
  padding: '24px',
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: 'var(--style-radius-m, 8px)',
  background: 'var(--theme-elevation-0)',
  color: 'var(--theme-text)',
  boxShadow: '0 20px 50px rgba(0, 0, 0, 0.25)',
}

const input: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: '0.5rem',
  padding: '0.6rem 0.75rem',
  fontSize: '1rem',
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: 'var(--style-radius-s, 4px)',
  background: 'var(--theme-input-bg, var(--theme-elevation-0))',
  color: 'var(--theme-text)',
}

export function useAdminDialog() {
  const ref = useRef<HTMLDialogElement>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [value, setValue] = useState('')

  useEffect(() => {
    const el = ref.current
    if (pending && el && !el.open) el.showModal()
  }, [pending])

  const close = useCallback(
    (result: boolean) => {
      if (!pending) return
      if (pending.kind === 'confirm') pending.resolve(result)
      else pending.resolve(result ? value.trim() : null)
      ref.current?.close()
      setPending(null)
      setValue('')
    },
    [pending, value],
  )

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ kind: 'confirm', options, resolve })),
    [],
  )

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => setPending({ kind: 'prompt', options, resolve })),
    [],
  )

  const options = pending?.options
  const minLength = pending?.kind === 'prompt' ? (pending.options.minLength ?? 1) : 0
  const canSubmit = pending?.kind !== 'prompt' || value.trim().length >= minLength

  const submit = (e: FormEvent) => {
    e.preventDefault()
    // Событие React всплывает через портал к onSubmit внешней формы документа — не пускаем.
    e.stopPropagation()
    if (canSubmit) close(true)
  }

  const dialogNode = (
    <dialog
      ref={ref}
      aria-labelledby="admin-dialog-title"
      style={box}
      // Esc — как «Отмена».
      onCancel={(e) => {
        e.preventDefault()
        close(false)
      }}
      onClick={(e) => {
        // Клик по затемнённому фону закрывает окно.
        if (e.target === e.currentTarget) close(false)
      }}
    >
      <style>{`dialog[aria-labelledby="admin-dialog-title"]::backdrop{background:rgba(0,0,0,.45)}dialog[aria-labelledby="admin-dialog-title"] .btn{margin:0}`}</style>
      {options && (
        <form onSubmit={submit}>
          <h2 id="admin-dialog-title" style={{ margin: '0 0 0.75rem', fontSize: '1.35rem' }}>
            {options.title}
          </h2>
          {options.body && (
            <div style={{ margin: '0 0 1rem', color: 'var(--theme-elevation-800)' }}>
              {options.body}
            </div>
          )}
          {pending?.kind === 'prompt' && (
            <label style={{ display: 'block', margin: '0 0 1rem' }}>
              {pending.options.label ?? 'Ответ'}
              <input
                style={input}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={pending.options.placeholder}
                autoFocus
                required
                minLength={minLength}
              />
            </label>
          )}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <Button type="button" buttonStyle="secondary" onClick={() => close(false)}>
              {options.cancelLabel ?? 'Отмена'}
            </Button>
            <Button
              type="submit"
              buttonStyle={options.danger ? 'error' : 'primary'}
              disabled={!canSubmit}
            >
              {options.confirmLabel ?? 'Подтвердить'}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  )

  // Пока окно не открыто, ничего не рендерим (и на сервере document нет — pending там не бывает).
  const element =
    pending && typeof document !== 'undefined' ? createPortal(dialogNode, document.body) : null

  return { element, confirm, prompt }
}
