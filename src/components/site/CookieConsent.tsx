'use client'

import { Button, Checkbox, Description, Label } from '@heroui/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import {
  COOKIE_CONSENT_NAME,
  COOKIE_CONSENT_VERSION,
  cookieConsentHeader,
  parseCookieConsent,
  parseMetrikaId,
  readCookie,
  type CookieConsent as Consent,
} from '@/modules/consent'

import { createMetrikaLoader, type MetrikaLoader } from './metrika'
import styles from './CookieConsent.module.css'

/** Открыть баннер ещё раз (ссылка «Настройки cookie» в подвале). */
export const COOKIE_SETTINGS_EVENT = 'turdus:cookie-settings'
const CHANGE_EVENT = 'turdus:cookie-consent'

// Номер счётчика вшивается при сборке; без него Метрика не загружается никогда.
const COUNTER_ID = parseMetrikaId(process.env.NEXT_PUBLIC_YM_ID)

let loader: MetrikaLoader | null = null
const getLoader = () =>
  (loader ??= createMetrikaLoader({ counterId: COUNTER_ID, doc: document, win: window }))

const subscribe = (cb: () => void) => {
  window.addEventListener(CHANGE_EVENT, cb)
  return () => window.removeEventListener(CHANGE_EVENT, cb)
}
const readRaw = () => readCookie(document.cookie, COOKIE_CONSENT_NAME) ?? ''

function save(analytics: boolean) {
  document.cookie = cookieConsentHeader(
    { version: COOKIE_CONSENT_VERSION, analytics, at: new Date() },
    window.location.protocol === 'https:',
  )
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/**
 * Баннер cookie (T-036, PRD WEB-06/07). Не модальный: не перекрывает страницу и не забирает
 * фокус при первом показе; кнопки «Принять» и «Только необходимые» равнозначны. Решение — в cookie
 * с версией текста; Метрика запускается только после «Принять» (или галочки в настройках).
 * На сервере и до гидрации баннер не рисуется — у вернувшегося зрителя он не мигает.
 */
export function CookieConsent() {
  // null на сервере; '' — решения нет; иначе — значение cookie.
  const raw = useSyncExternalStore(subscribe, readRaw, () => null)
  const consent: Consent | null = raw ? parseCookieConsent(raw) : null
  const [reopened, setReopened] = useState(false)
  const [settings, setSettings] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const pathname = usePathname()
  const lastPath = useRef<string | null>(null)

  // Решение применяется сразу; отзыв после загрузки счётчика — стираем его cookie и перезагружаем.
  useEffect(() => {
    if (raw === null) return
    const decided = parseCookieConsent(raw)
    const metrika = getLoader()
    if (decided?.analytics) metrika.apply(decided)
    else if (metrika.revoke()) window.location.reload()
  }, [raw])

  // Клиентские переходы — отдельный просмотр (первый засчитывает init).
  useEffect(() => {
    const url = window.location.href
    if (lastPath.current !== null && lastPath.current !== url)
      getLoader().hit(url, lastPath.current)
    lastPath.current = url
  }, [pathname])

  useEffect(() => {
    const open = () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setAnalytics(Boolean(parseCookieConsent(readRaw())?.analytics))
      setSettings(true)
      setReopened(true)
      // По явной просьбе зрителя — фокус в баннер, чтобы читалка его озвучила.
      window.requestAnimationFrame(() => titleRef.current?.focus())
    }
    window.addEventListener(COOKIE_SETTINGS_EVENT, open)
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, open)
  }, [])

  if (raw === null || (consent && !reopened)) return null

  const close = () => {
    setReopened(false)
    setSettings(false)
    opener.current?.focus()
    opener.current = null
  }

  const decide = (allow: boolean) => {
    save(allow)
    close()
  }

  return (
    <section className={styles.banner} aria-labelledby="cookie-consent-title">
      <h2 id="cookie-consent-title" className={styles.title} ref={titleRef} tabIndex={-1}>
        Cookie на сайте
      </h2>
      <p className={styles.text}>
        Необходимые cookie нужны для входа в кабинет и покупки билетов. С вашего разрешения включим
        Яндекс Метрику — она помогает понять, чем сайт удобен, а что стоит исправить.{' '}
        <Link href="/documents/cookies">Подробнее о cookie</Link>
      </p>

      {settings && (
        <div className={styles.options} role="group" aria-label="Какие cookie разрешить">
          <Checkbox isSelected isDisabled>
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>Необходимые</Label>
            </Checkbox.Content>
            <Description>Вход, корзина, ваш выбор о cookie. Отключить нельзя.</Description>
          </Checkbox>
          <Checkbox isSelected={analytics} onChange={setAnalytics}>
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>Аналитика — Яндекс Метрика</Label>
            </Checkbox.Content>
            <Description>
              Обезличенная статистика посещений. Без записи действий на экране.
            </Description>
          </Checkbox>
        </div>
      )}

      <div className={styles.actions}>
        {settings ? (
          <>
            <Button variant="primary" onPress={() => decide(analytics)}>
              Сохранить выбор
            </Button>
            {reopened && consent && (
              <Button variant="ghost" onPress={close}>
                Отмена
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="primary" onPress={() => decide(true)}>
              Принять
            </Button>
            <Button variant="primary" onPress={() => decide(false)}>
              Только необходимые
            </Button>
            {/* Кнопка react-aria (нажатие по keyup): обычная кнопка по Enter открывала настройки,
                а отпущенная клавиша «нажимала» появившуюся на её месте «Сохранить выбор». */}
            <Button
              variant="ghost"
              onPress={() => {
                setSettings(true)
                // Фокус — в открывшиеся настройки, а не в никуда (кнопка исчезла).
                window.requestAnimationFrame(() => titleRef.current?.focus())
              }}
            >
              Настроить
            </Button>
          </>
        )}
      </div>
    </section>
  )
}

/** Кнопка в подвале: снова открыть выбор (отозвать или дать согласие). */
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))}
    >
      Настройки cookie
    </button>
  )
}
