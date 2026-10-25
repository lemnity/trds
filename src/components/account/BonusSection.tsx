'use client'

import { Button } from '@heroui/react'
import { useEffect, useRef, useState } from 'react'

import { formatRub } from '@/lib/money'
import { LOYALTY_RULES, referralRemainingText } from '@/modules/loyalty'

import { InlineNotice } from '../ui/InlineNotice'
import { reveal } from '../ui/reveal'
import styles from './Account.module.css'
import {
  formatDate,
  formatDayMonth,
  formatSignedRub,
  historyLabel,
  lifetimeText,
  referralCaption,
  rulesLine,
  type LoyaltySummary,
} from './loyalty-view'
import { reloadLoyalty, useLoyalty } from './useLoyalty'

export const DemoBadge = () => (
  <span className={styles.badge} title="Демо-данные в этом браузере, не настоящий баланс">
    Демо
  </span>
)

/** Копирование в буфер: Clipboard API, иначе — старый способ через скрытое поле. */
const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    return ok
  }
}

function ReferralCard({ referral }: { referral: LoyaltySummary['referral'] | null }) {
  const [copied, setCopied] = useState<'' | 'ok' | 'fail'>('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const reward = formatRub(LOYALTY_RULES.referralRewardKopecks)
  const progress = referral?.progress ?? {
    inRound: 0,
    remaining: LOYALTY_RULES.referralGroupSize,
    rewards: 0,
    groupSize: LOYALTY_RULES.referralGroupSize,
  }

  const copy = async () => {
    if (!referral) return
    setCopied((await copyText(referral.link)) ? 'ok' : 'fail')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(''), 4000)
  }

  return (
    <>
      <p className={styles.cardLabel}>Приведи {progress.groupSize} друга</p>
      <p className={styles.cardText}>
        За каждых трёх друзей, которые купят билет по вашей ссылке, начислим {reward} бонусами. Друг
        засчитывается после первой оплаченной покупки.
      </p>
      <div className={styles.linkRow}>
        <span className={styles.link} aria-disabled={referral ? undefined : 'true'}>
          {referral?.link ?? 'Ссылка появится после входа'}
        </span>
        <Button variant="outline" onPress={copy} isDisabled={!referral}>
          Скопировать
        </Button>
      </div>
      <p className={styles.live} role="status" aria-live="polite">
        {copied === 'ok'
          ? 'Ссылка скопирована'
          : copied === 'fail'
            ? 'Не получилось скопировать — выделите ссылку и скопируйте вручную'
            : ''}
      </p>
      <div
        role="progressbar"
        aria-label="Друзья с первой покупкой"
        aria-valuemin={0}
        aria-valuemax={progress.groupSize}
        aria-valuenow={progress.inRound}
        aria-valuetext={`${progress.inRound} из ${progress.groupSize}`}
        className={styles.steps}
      >
        {Array.from({ length: progress.groupSize }, (_, i) => (
          <span key={i} className={styles.step} data-filled={i < progress.inRound || undefined} />
        ))}
      </div>
      <p className={styles.caption}>
        {progress.inRound} из {progress.groupSize} ·{' '}
        {referralCaption(progress, referralRemainingText)}
      </p>
      {progress.rewards > 0 && (
        <p className={styles.cardMeta}>
          Уже начислено: {progress.rewards} × {reward}
        </p>
      )}
    </>
  )
}

function History({ history }: { history: LoyaltySummary['history'] }) {
  if (history.length === 0)
    return (
      <p className={styles.cardText}>
        Начислений и списаний пока нет. Бонусы появятся после первой оплаченной покупки.
      </p>
    )
  return (
    <ul className={styles.history}>
      {history.map((h) => (
        <li key={h.id}>
          <span className={styles.historyDate}>{formatDate(h.at)}</span>
          <span className={styles.historyWhat}>
            {historyLabel(h.kind)}
            {h.amountKopecks > 0 && h.expiresAt && (
              <small>действуют до {formatDate(h.expiresAt)}</small>
            )}
          </span>
          <span className={styles.amount} data-sign={h.amountKopecks > 0 ? 'plus' : undefined}>
            {formatSignedRub(h.amountKopecks)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Раздел «Бонусы»: баланс, «Приведи 3 друга», история и правила (PRD §5.6). */
export function BonusSection() {
  const loyalty = useLoyalty()
  const data = loyalty.status === 'ready' ? loyalty.data : null
  const demo = loyalty.status === 'ready' && loyalty.demo
  const loading = loyalty.status === 'loading'

  return (
    <>
      {loyalty.status === 'unavailable' && (
        <div className={styles.notice}>
          <InlineNotice tone="warning" title="Бонусы временно недоступны">
            Не получилось загрузить баланс и историю. Покупка билетов работает как обычно.{' '}
            <button type="button" className={styles.retry} onClick={() => reloadLoyalty(true)}>
              Повторить
            </button>
          </InlineNotice>
        </div>
      )}
      <div className={styles.bonusGrid} aria-busy={loading}>
        <div className={`${styles.card} ${styles.balance}`} {...reveal(1)}>
          <p className={styles.cardLabel}>Баланс {demo && <DemoBadge />}</p>
          <p className={styles.balanceValue}>
            {loading || loyalty.status === 'unavailable'
              ? '—'
              : formatRub(data?.balanceKopecks ?? 0)}
          </p>
          {data?.expiring && (
            <p className={styles.expiring}>
              {formatRub(data.expiring.amountKopecks)} сгорят{' '}
              {formatDayMonth(data.expiring.earliest)}
            </p>
          )}
          <p className={`${styles.cardMeta} ${styles.rules}`}>{rulesLine()}</p>
          <p className={styles.cardText}>
            {loyalty.status === 'guest'
              ? 'Войдите, чтобы увидеть баланс и историю бонусов.'
              : 'Бонусами можно оплатить часть следующего билета при оформлении заказа.'}
          </p>
        </div>
        <div className={styles.card} {...reveal(2)}>
          <ReferralCard referral={data?.referral ?? null} />
        </div>
        <div className={`${styles.card} ${styles.wide}`} {...reveal(3)}>
          <p className={styles.cardLabel}>История {demo && <DemoBadge />}</p>
          {loading ? (
            <p className={styles.cardText}>Загружаем историю…</p>
          ) : (
            <History history={data?.history ?? []} />
          )}
        </div>
      </div>
      <p className={styles.note}>
        Бонусы начисляются после оплаты — {LOYALTY_RULES.accrualBasisPoints / 100}% от суммы,
        оплаченной деньгами. Бонусами можно оплатить до {LOYALTY_RULES.maxSpendBasisPoints / 100}%
        стоимости билета. Каждое начисление действует{' '}
        {lifetimeText(LOYALTY_RULES.bonusLifetimeDays)}, первыми списываются те, что сгорят раньше.
        За покупку и активацию сертификатов бонусы не начисляются.
        {demo &&
          ' Сейчас показаны демо-данные этого браузера: начисления не настоящие, сертификат примет любой номер правильного формата.'}
      </p>
    </>
  )
}
