/**
 * Тексты входа через Яндекс ID (T-056) — отдельно от компонентов, чтобы проверить тестом, что
 * каждый исход возврата с Яндекса (`?yandex=<код>`) превращается в понятное сообщение.
 */

export type YandexNotice = { tone: 'danger' | 'info'; title: string; text: string }

const FAILED_TITLE = 'Не получилось войти через Яндекс ID'

const SIGN_IN: Record<string, string> = {
  unavailable: 'Вход через Яндекс ID пока не подключён. Войдите по коду из письма.',
  too_many: 'Слишком много попыток. Попробуйте через 10 минут.',
  redirect_mismatch: 'Сайт открыт не по основному адресу. Откройте сайт заново и повторите вход.',
  state: 'Вход устарел или начат в другой вкладке. Нажмите «Войти с Яндекс ID» ещё раз.',
  denied: 'Вы отменили вход на странице Яндекса. Можно войти по коду из письма.',
  email_unverified:
    'В Яндекс ID нет подтверждённой почты. Подтвердите её в Яндексе или войдите по коду из письма.',
  failed: 'Яндекс не ответил. Попробуйте ещё раз или войдите по коду из письма.',
}

/** `?yandex=` на /login и /register → сообщение (неизвестный код — общий текст). */
export function yandexSignInNotice(code: string | null): YandexNotice | null {
  if (!code) return null
  return { tone: 'danger', title: FAILED_TITLE, text: SIGN_IN[code] ?? SIGN_IN.failed! }
}

/** `?yandex=` в профиле после привязки → сообщение. */
export function yandexLinkNotice(code: string | null): YandexNotice | null {
  if (!code) return null
  if (code === 'linked')
    return {
      tone: 'info',
      title: 'Яндекс ID привязан',
      text: 'Теперь в кабинет можно входить кнопкой «Войти с Яндекс ID».',
    }
  const title = 'Яндекс ID не привязан'
  if (code === 'taken')
    return {
      tone: 'danger',
      title,
      text: 'Этот Яндекс ID уже привязан к другому кабинету. Отвяжите его там или выберите другой.',
    }
  if (code === 'already_linked')
    return { tone: 'danger', title, text: 'К кабинету уже привязан другой Яндекс ID.' }
  return { tone: 'danger', title, text: SIGN_IN[code] ?? SIGN_IN.failed! }
}

/** Ответ `POST /api/auth/yandex/complete` (кроме 200) → сообщение. */
export function yandexCompleteError(status: number, error?: string | null): string {
  if (status === 400 && error === 'expired')
    return 'Подтверждение устарело. Начните вход через Яндекс ID заново.'
  if (status === 400) return 'Отметьте согласие на обработку персональных данных.'
  if (status === 429) return 'Слишком много попыток. Попробуйте через 10 минут.'
  if (status === 0 || status === 503) return 'Нет связи с сервером. Попробуйте ещё раз чуть позже.'
  return 'Что-то пошло не так. Попробуйте ещё раз.'
}
