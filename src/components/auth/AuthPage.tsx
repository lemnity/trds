import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'

import logo from '@/assets/logo.webp'
import { getShowsData } from '@/modules/shows'

import { AuthForm } from './AuthForm'
import { AuthSlideshow } from './AuthSlideshow'
import { YandexButton } from './YandexButton'
import styles from './Auth.module.css'

const COPY = {
  login: {
    title: 'Вход',
    lead: 'Войдите по почте, на которую покупали билеты.',
    switchText: 'Впервые у нас?',
    switchLink: { href: '/register', label: 'Регистрация' },
  },
  register: {
    title: 'Регистрация',
    lead: 'Кабинет на почту: билеты, возвраты и бонусы в одном месте.',
    switchText: 'Уже есть кабинет?',
    switchLink: { href: '/login', label: 'Войти' },
  },
  yandex: {
    title: 'Регистрация через Яндекс ID',
    lead: 'Проверьте данные из Яндекса — создадим кабинет на эту почту.',
    switchText: 'Передумали?',
    switchLink: { href: '/login', label: 'Войти по почте' },
  },
} as const

/**
 * Кадры для слайд-шоу — отобраны вручную: актёры в сцене, а не зрители в зале
 * (номер — позиция в галерее спектакля). У «Гостей» в галерее только гости ужина — не берём.
 */
const STAGE_SHOTS = [
  { slug: 'concertsp', index: 0 },
  { slug: 'normalflight', index: 2 },
  { slug: 'taro', index: 1 },
  { slug: 'vbare2', index: 7 },
  { slug: 'facetoface', index: 2 },
  { slug: 'normalflight', index: 5 },
  { slug: 'taro', index: 3 },
  { slug: '8women', index: 1 },
]

const PERKS = [
  'Билеты и QR — всегда под рукой',
  'Возврат в пару нажатий',
  'Бонусы за покупки и друзей',
]

/**
 * Страница входа/регистрации: слева — тёмная панель с кадром спектакля и тем, что даёт кабинет,
 * справа — «Войти с Яндекс ID» (если включён) и форма по одноразовому коду (AuthForm).
 * `children` заменяет форму (подтверждение регистрации через Яндекс). Страницы не индексируются.
 */
export function AuthPage({
  mode,
  children,
}: {
  mode: 'login' | 'register' | 'yandex'
  children?: ReactNode
}) {
  const copy = COPY[mode]
  const shows = new Map(getShowsData().shows.map((s) => [s.slug, s]))
  const photos = STAGE_SHOTS.flatMap(({ slug, index }) => {
    const show = shows.get(slug)
    const src = show?.status === 'published' ? show.gallery[index] : undefined
    return src ? [{ src, title: show!.title }] : []
  })

  return (
    <div className={`container ${styles.page}`}>
      {/* Шапки сайта здесь нет — логотип и путь назад. */}
      <div className={styles.bar}>
        <Link href="/" className={styles.brand}>
          <Image
            src={logo}
            alt="TURDUS — модный театр, на главную"
            className={styles.logo}
            priority
          />
        </Link>
        <Link href="/" className={styles.back}>
          ← Вернуться на сайт
        </Link>
      </div>
      <div className={styles.shell}>
        <aside className={styles.visual}>
          <AuthSlideshow photos={photos} />
          <div className={styles.visualText}>
            <p className={styles.visualKicker}>Личный кабинет</p>
            <p className={styles.visualTitle}>Повод выйти в свет — в одном месте</p>
            <ul className={styles.perks}>
              {PERKS.map((perk) => (
                <li key={perk}>{perk}</li>
              ))}
            </ul>
          </div>
        </aside>

        <section className={styles.panel} aria-labelledby="auth-title">
          <h1 id="auth-title" className={styles.title}>
            {copy.title}
          </h1>
          <p className={styles.lead}>{copy.lead}</p>
          {mode === 'yandex' ? (
            children
          ) : (
            <>
              <YandexButton mode={mode} />
              <AuthForm mode={mode} />
            </>
          )}
          <p className={styles.switch}>
            {copy.switchText} <Link href={copy.switchLink.href}>{copy.switchLink.label}</Link>
          </p>
        </section>
      </div>
    </div>
  )
}
