import { mayLoadAnalytics, type CookieConsent } from '@/modules/consent'

/**
 * Загрузчик Яндекс Метрики (T-036). Скрипт и вызовы `ym` появляются только после явного
 * согласия на аналитику и только если задан номер счётчика (NEXT_PUBLIC_YM_ID) — до этого
 * ни одного запроса к mc.yandex.ru. Документ и окно передаются снаружи: в тестах — подделки.
 */

export const METRIKA_SRC = 'https://mc.yandex.ru/metrika/tag.js'

type YmFn = ((...args: unknown[]) => void) & { a?: unknown[][]; l?: number }

export type MetrikaWindow = {
  ym?: YmFn
  localStorage?: Pick<Storage, 'length' | 'key' | 'removeItem'>
}

export type MetrikaDocument = {
  createElement(tag: 'script'): { async: boolean; src: string }
  head: { appendChild(node: unknown): unknown }
  cookie: string
  location?: { hostname: string }
}

// Вебвизор записывает действия зрителя (ввод в формы) — не включаем без решения театра и юриста.
const INIT_OPTIONS = {
  clickmap: true,
  trackLinks: true,
  accurateTrackBounce: true,
  webvisor: false,
}

export function createMetrikaLoader({
  counterId,
  doc,
  win,
}: {
  counterId: string | null
  doc: MetrikaDocument
  win: MetrikaWindow
}) {
  let loaded = false

  return {
    get loaded() {
      return loaded
    },

    /** Применить решение зрителя. true — счётчик запущен этим вызовом. */
    apply(consent: CookieConsent | null) {
      if (loaded || !mayLoadAnalytics(consent, counterId)) return false
      // Очередь до загрузки tag.js — официальный сниппет Метрики.
      const ym: YmFn =
        win.ym ??
        Object.assign(
          (...args: unknown[]) => {
            ;(ym.a ??= []).push(args)
          },
          { l: Date.now() },
        )
      win.ym = ym
      const script = doc.createElement('script')
      script.async = true
      script.src = METRIKA_SRC
      doc.head.appendChild(script)
      ym(Number(counterId), 'init', INIT_OPTIONS)
      loaded = true
      return true
    },

    /** Переход между страницами без перезагрузки (клиентская навигация Next). */
    hit(url: string, referrer?: string) {
      if (loaded) win.ym?.(Number(counterId), 'hit', url, referrer ? { referer: referrer } : {})
    },

    /**
     * Отзыв согласия: стираем cookie и записи Метрики (`_ym*`). Уже загруженный скрипт
     * выгрузить нельзя — true значит «нужна перезагрузка страницы».
     */
    revoke() {
      const names = doc.cookie
        .split(';')
        .map((part) => part.split('=')[0]!.trim())
        .filter((name) => name.startsWith('_ym'))
      const host = doc.location?.hostname ?? ''
      // Метрика ставит cookie на домен верхнего уровня (.teatrturdus.ru) — стираем на всех уровнях.
      const labels = host.split('.')
      const domains = [
        '',
        ...labels.slice(0, -1).map((_, i) => `; Domain=.${labels.slice(i).join('.')}`),
      ]
      for (const name of names)
        for (const domain of domains)
          doc.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${domain}`
      try {
        const storage = win.localStorage
        if (storage)
          for (let i = storage.length - 1; i >= 0; i--) {
            const key = storage.key(i)
            if (key?.startsWith('_ym')) storage.removeItem(key)
          }
      } catch {
        // Хранилище недоступно — нечего стирать.
      }
      return loaded
    },
  }
}

export type MetrikaLoader = ReturnType<typeof createMetrikaLoader>
