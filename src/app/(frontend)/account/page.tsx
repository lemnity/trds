import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { IS_PREVIEW } from '@/lib/site'

import { AccountStats } from '@/components/account/AccountStats'
import { BonusSection } from '@/components/account/BonusSection'
import { CertificateSection } from '@/components/account/CertificateSection'
import { ProfileSecurity } from '@/components/account/ProfileSecurity'
import { TicketsSection } from '@/components/account/TicketsSection'
import { YandexLink } from '@/components/account/YandexLink'
import { ButtonLink } from '@/components/ui/ButtonLink'
import { reveal } from '@/components/ui/reveal'
import { contacts } from '@/modules/content'

import head from '../page-head.module.css'
import styles from './account.module.css'

export const metadata: Metadata = {
  title: 'Личный кабинет',
  robots: { index: false, follow: false },
}

/**
 * `hasPassword` — для блока «Пароль и сеансы» (сам хеш со страницы не уходит);
 * `yandexLinked` — привязан ли Яндекс ID (T-056).
 */
type Customer = { name: string | null; email: string; hasPassword: boolean; yandexLinked: boolean }

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
  let yandexLinked: boolean
  try {
    const { auth } = await getAccounts()
    hasPassword = await auth.hasPassword(session.customer.id)
    yandexLinked = (await auth.linkedProviders(session.customer.id)).includes('yandex')
  } catch {
    return 'unavailable'
  }
  return { name: session.customer.name, email: session.customer.email, hasPassword, yandexLinked }
}

const Soon = () => <span className={styles.soon}>Скоро</span>

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

      {/* Билеты — из useAccountTickets (/api/account/tickets), бонусы — из useLoyalty. */}
      <AccountStats />

      <section id="tickets" className={styles.section} aria-labelledby="tickets-title">
        <h2 id="tickets-title" className={styles.sectionTitle} {...reveal()}>
          Мои билеты
        </h2>
        {/* Билеты покупателя из сессии (T-051); на превью — демо. */}
        <TicketsSection />
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
          <YandexLink
            linked={customer?.yandexLinked ?? null}
            hasPassword={customer?.hasPassword ?? false}
          />
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
