'use client'

import { Button, Description, FieldError, Input, Label, TextField } from '@heroui/react'
import Link from 'next/link'
import { useEffect, useState, useSyncExternalStore } from 'react'

import { IS_STATIC_PREVIEW, useSession } from '@/components/auth/session'
import { formatRub } from '@/lib/money'
import { bonusRublesText, parseDemoBalance } from '@/modules/checkout'
import { LOYALTY_RULES, type BonusApplication } from '@/modules/loyalty'

import styles from './Checkout.module.css'

/** Бонусный счёт зрителя для корзины. Баланс — только подсказка: списание пересчитает сервер. */
export type BonusAccount =
  | { status: 'guest' }
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; balanceKopecks: number; demo: boolean }

// Тот же ключ, что у кабинета на превью; формат — `{"balanceKopecks": N}`.
const DEMO_KEY = 'turdus:demo-loyalty'
const TIMEOUT_MS = 8_000
const noopSubscribe = () => () => {}
const readDemo = () => {
  try {
    return window.localStorage.getItem(DEMO_KEY)
  } catch {
    return null
  }
}
const subscribeDemo = (cb: () => void) => {
  window.addEventListener('storage', cb)
  return () => window.removeEventListener('storage', cb)
}

const loadSummary = async (signal: AbortSignal): Promise<BonusAccount> => {
  const res = await fetch('/api/loyalty/summary', {
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  })
  // 401 — сессия истекла: показываем как гостю, с предложением войти.
  if (res.status === 401) return { status: 'guest' }
  if (!res.ok) return { status: 'unavailable' }
  const data: unknown = await res.json()
  const balance =
    data && typeof data === 'object' && 'balanceKopecks' in data ? data.balanceKopecks : null
  return typeof balance === 'number' && Number.isSafeInteger(balance) && balance >= 0
    ? { status: 'ready', balanceKopecks: balance, demo: false }
    : { status: 'unavailable' }
}

/**
 * Баланс: на сервере — `GET /api/loyalty/summary`, на статическом превью и в демо-сессии —
 * демо-значение из localStorage (сервера нет). До гидрации и загрузки сессии — как у гостя.
 */
export function useBonusAccount(): BonusAccount {
  const session = useSession()
  const demo = IS_STATIC_PREVIEW || Boolean(session?.demo)
  const demoRaw = useSyncExternalStore(
    demo ? subscribeDemo : noopSubscribe,
    demo ? readDemo : () => null,
    () => null,
  )
  const email = session && !demo ? session.email : null
  const [loaded, setLoaded] = useState<{ email: string; account: BonusAccount } | null>(null)

  useEffect(() => {
    if (!email) return
    const controller = new AbortController()
    let cancelled = false
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
    loadSummary(controller.signal)
      .catch((): BonusAccount => ({ status: 'unavailable' }))
      .then((account) => {
        if (!cancelled) setLoaded({ email, account })
      })
      .finally(() => window.clearTimeout(timer))
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [email])

  if (!session) return { status: 'guest' }
  if (demo) return { status: 'ready', balanceKopecks: parseDemoBalance(demoRaw), demo: true }
  return loaded?.email === email ? loaded.account : { status: 'loading' }
}

type Props = {
  account: BonusAccount
  loginHref: string
  /** Результат `applyBonus` — единственный источник сумм в блоке. */
  bonus: BonusApplication
  /** Сколько зритель ввёл (копейки) — только чтобы объяснить обрезку до максимума. */
  requestedKopecks: number
  value: string
  isInvalid: boolean
  onChange: (value: string) => void
}

const maxPercent = LOYALTY_RULES.maxSpendBasisPoints / 100
const accrualPercent = LOYALTY_RULES.accrualBasisPoints / 100

/** Поле «Бонусы» в корзине (PRD §5.6): гостю — приглашение войти, вошедшему — баланс и списание. */
export function CheckoutBonus({
  account,
  loginHref,
  bonus,
  requestedKopecks,
  value,
  isInvalid,
  onChange,
}: Props) {
  if (account.status === 'guest') {
    return (
      <section className={styles.bonus} aria-label="Бонусы">
        <p>
          <Link href={loginHref} className={styles.bonusLink}>
            Войдите
          </Link>
          , чтобы копить и тратить бонусы: {accrualPercent}% с покупки
        </p>
      </section>
    )
  }

  if (account.status === 'loading') {
    return (
      <section className={styles.bonus} aria-label="Бонусы" aria-busy="true">
        <p className={styles.bonusMuted}>Загружаем бонусный счёт…</p>
      </section>
    )
  }

  if (account.status === 'unavailable') {
    return (
      <section className={styles.bonus} aria-label="Бонусы">
        <p className={styles.bonusMuted}>
          Бонусный счёт сейчас недоступен — заказ можно оформить без бонусов.
        </p>
      </section>
    )
  }

  const demoBadge = account.demo && <span className={styles.bonusDemo}>Демо</span>

  if (bonus.maxKopecks === 0) {
    return (
      <section className={styles.bonus} aria-label="Бонусы">
        <p>
          На счёте {formatRub(account.balanceKopecks)} · за этот заказ начислится{' '}
          {formatRub(bonus.accrualKopecks)} {demoBadge}
        </p>
      </section>
    )
  }

  const clamped = !isInvalid && requestedKopecks > bonus.maxKopecks
  const atMax = bonus.spentKopecks === bonus.maxKopecks

  return (
    <section className={styles.bonus} aria-labelledby="checkout-bonus-title">
      <h2 id="checkout-bonus-title" className={styles.bonusTitle}>
        Бонусы {demoBadge}
      </h2>
      <TextField
        value={value}
        onChange={onChange}
        // После ухода из поля показываем то, что реально спишется.
        onBlur={() => clamped && onChange(bonusRublesText(bonus.maxKopecks))}
        inputMode="numeric"
        autoComplete="off"
        isInvalid={isInvalid}
        validationBehavior="aria"
        className={styles.field}
      >
        <Label>Списать бонусами, ₽</Label>
        <Input placeholder="0" className={styles.bonusInput} />
        <Description className={styles.bonusHint}>
          Доступно {formatRub(account.balanceKopecks)} · можно списать до{' '}
          {formatRub(bonus.maxKopecks)} ({maxPercent}% стоимости билетов)
        </Description>
        <FieldError>Введите сумму целым числом рублей, например 300</FieldError>
      </TextField>
      {/* Живой регион: объяснение, почему списали меньше введённого. */}
      <p role="status" className={styles.bonusHint}>
        {clamped && `Больше ${formatRub(bonus.maxKopecks)} списать нельзя — спишем максимум.`}
      </p>
      <div className={styles.bonusActions}>
        <Button
          variant="outline"
          isDisabled={atMax && !clamped}
          onPress={() => onChange(bonusRublesText(bonus.maxKopecks))}
        >
          Списать максимум
        </Button>
        <Button
          variant="ghost"
          isDisabled={value === '' && bonus.spentKopecks === 0}
          onPress={() => onChange('')}
        >
          Не списывать
        </Button>
      </div>
    </section>
  )
}
