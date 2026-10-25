import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { IS_PREVIEW } from '@/lib/site'

import { AccountStats } from '@/components/account/AccountStats'
import { BonusSection } from '@/components/account/BonusSection'
import { CertificateSection } from '@/components/account/CertificateSection'
import { ProfileSecurity } from '@/components/account/ProfileSecurity'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { PageTabs } from '@/components/ui/PageTabs'
import { reveal } from '@/components/ui/reveal'
import { TicketIcon } from '@/components/ui/TicketIcon'
import { contacts } from '@/modules/content'

import head from '../page-head.module.css'
import styles from './account.module.css'

export const metadata: Metadata = {
  title: 'Личный кабинет',
  robots: { index: false, follow: false },
}

/** `hasPassword` — для блока «Пароль и сеансы» (сам хеш со страницы не уходит). */
type Customer = { name: string | null; email: string; hasPassword: boolean }

/**
 * Билеты в кабинете. ЗАГЛУШКА до T-051: продаж на этом сайте ещё нет, поэтому у любого
 * покупателя честные нули. Когда появятся заказы — считать из БД. Бонусы, друзья и сертификаты
 * приходят в браузере из /api/loyalty/summary (useLoyalty), на превью — демо.
 */
const getSummary = () => ({
  upcoming: 0,
  past: 0,
  refunded: 0,
})

/**
 * Кабинет (T-050/T-051). На сервере — только для вошедших: без сессии — на вход с возвратом сюда.
 * На статическом превью (без сервера) проверки нет — страница показывает разделы как есть.
 */
async function currentCustomer(): Promise<Customer | null | 'unavailable'> {
  if (IS_PREVIEW) return null
  const { getAccounts, SESSION_COOKIE } = await import('@/modules/accounts')
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  let session
  try {
    session = await (await getAccounts()).auth.getSession(token)
  } catch {
    // База недоступна — честное сообщение вместо ошибки или бесконечной загрузки.
    return 'unavailable'
  }
  if (!session) redirect('/login?next=/account')
  let hasPassword: boolean
  try {
    hasPassword = await (await getAccounts()).auth.hasPassword(session.customer.id)
  } catch {
    return 'unavailable'
  }
  return { name: session.customer.name, email: session.customer.email, hasPassword }
}

const Soon = () => <span className={styles.soon}>Скоро</span>

function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true">
        <TicketIcon />
      </span>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyText}>{text}</p>
      {action}
    </div>
  )
}

export default async function AccountPage() {
  const current = await currentCustomer()
  if (current === 'unavailable')
    return (
      <div className={`container ${styles.page}`}>
        <header className={head.head}>
          <p className={styles.kicker}>Личный кабинет</p>
          <h1 className={head.title}>Кабинет временно недоступен</h1>
          <p className={head.lead}>
            Не получается связаться с сервером. Попробуйте обновить страницу через пару минут.
          </p>
        </header>
        <ButtonLink href="/afisha">Перейти в афишу</ButtonLink>
      </div>
    )
  const customer = current
  const s = getSummary()

  return (
    <div className={`container ${styles.page}`}>
      <header className={head.head} {...reveal()}>
        <p className={styles.kicker}>Личный кабинет</p>
        <h1 className={head.title}>
          {customer?.name ? `Здравствуйте, ${customer.name.split(' ')[0]}` : 'Личный кабинет'}
        </h1>
        <p className={head.lead}>
          {customer
            ? `Вы вошли как ${customer.email}.`
            : 'Билеты, возвраты и бонусы — в одном месте.'}
        </p>
      </header>

      {/* Билеты — заглушки до продаж на сайте (getSummary), бонусы — из useLoyalty. */}
      <AccountStats upcoming={s.upcoming} past={s.past} />

      <section id="tickets" className={styles.section} aria-labelledby="tickets-title">
        <h2 id="tickets-title" className={styles.sectionTitle} {...reveal()}>
          Мои билеты
        </h2>
        <PageTabs
          label="Мои билеты"
          tabs={[
            {
              id: 'upcoming',
              label: 'Будущие',
              count: s.upcoming,
              panel: (
                <Empty
                  title="Билетов пока нет"
                  text="Здесь появятся билеты, купленные на этом сайте: QR-код для входа, дата, площадка и статус."
                  action={<ButtonLink href="/afisha">Выбрать спектакль</ButtonLink>}
                />
              ),
            },
            {
              id: 'past',
              label: 'Прошедшие',
              count: s.past,
              panel: (
                <Empty
                  title="Пока пусто"
                  text="После спектакля билет переедет сюда — с датой и площадкой, чтобы вспомнить вечер."
                />
              ),
            },
            {
              id: 'refunded',
              label: 'Возвраты',
              count: s.refunded,
              panel: (
                <Empty
                  title="Возвратов нет"
                  text="Если вернёте билет, здесь будет его статус: «в обработке» или «деньги возвращены»."
                />
              ),
            },
          ]}
        />
        <p className={styles.note}>
          Купили билет на текущем сайте театра? Он приходит на почту, указанную при покупке. Не
          нашли письмо — проверьте «Спам» или напишите театру:{' '}
          <a href={contacts.phone.href}>{contacts.phone.display}</a>,{' '}
          <a href={`mailto:${contacts.email}`}>{contacts.email}</a>.
        </p>
      </section>

      <section id="bonuses" className={styles.section} aria-labelledby="bonuses-title">
        <h2 id="bonuses-title" className={styles.sectionTitle} {...reveal()}>
          Бонусы
        </h2>
        <BonusSection />
      </section>

      <section id="certificate" className={styles.section} aria-labelledby="certificate-title">
        <h2 id="certificate-title" className={styles.sectionTitle} {...reveal()}>
          Сертификат
        </h2>
        <CertificateSection />
      </section>

      <section id="profile" className={styles.section} aria-labelledby="profile-title">
        <h2 id="profile-title" className={styles.sectionTitle} {...reveal()}>
          Профиль
        </h2>
        <dl className={styles.profile} {...reveal(1)}>
          <div>
            <dt>Имя</dt>
            <dd>{customer?.name ?? 'Не указано'}</dd>
          </div>
          <div>
            <dt>Почта</dt>
            <dd>{customer?.email ?? '—'}</dd>
          </div>
          <div>
            <dt>Телефон</dt>
            <dd className={styles.muted}>
              Не указан <Soon />
            </dd>
          </div>
          <ProfileSecurity hasPassword={customer?.hasPassword ?? null} />
          <div>
            <dt>Яндекс ID</dt>
            <dd className={styles.muted}>
              Не привязан <Soon />
            </dd>
          </div>
        </dl>
      </section>

      {/* Превью без сервера: вход — демо на /login и /register. */}
      {!customer && (
        <div className={styles.auth}>
          <ButtonLink href="/login">Войти</ButtonLink>
          <ButtonLink href="/register" variant="outline">
            Регистрация
          </ButtonLink>
        </div>
      )}
    </div>
  )
}
