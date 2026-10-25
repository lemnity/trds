import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { IS_PREVIEW } from '@/lib/site'

import { AuthPage } from '@/components/auth/AuthPage'
import { YandexSignupForm } from '@/components/auth/YandexSignupForm'
import { InlineNotice } from '@/components/ui/InlineNotice'
// Только тип: модуль кабинета (Payload, база) грузится динамически и не попадает в превью.
import type { PendingSignup } from '@/modules/accounts'

export const metadata: Metadata = {
  title: 'Регистрация через Яндекс ID',
  robots: { index: false, follow: false },
}

/**
 * Шаг согласия при первом входе через Яндекс ID (T-056). Почта и имя — из зашифрованной cookie,
 * которую поставил /api/auth/yandex/callback (15 минут). На статическом превью сервера нет.
 */
async function pendingProfile(): Promise<{ email: string; name: string | null } | null> {
  if (IS_PREVIEW) return null
  const { SIGNUP_COOKIE, unseal, yandexConfig } = await import('@/modules/accounts')
  const config = yandexConfig()
  if (!config) return null
  const pending = unseal<PendingSignup>(
    config.cookieKey,
    (await cookies()).get(SIGNUP_COOKIE)?.value,
  )
  return pending ? { email: pending.profile.email, name: pending.profile.name } : null
}

export default async function YandexSignupPage() {
  const profile = await pendingProfile()
  return (
    <AuthPage mode="yandex">
      {profile ? (
        <YandexSignupForm email={profile.email} name={profile.name} />
      ) : (
        <InlineNotice tone="info" title="Подтверждение устарело">
          Начните вход через Яндекс ID заново на странице <Link href="/register">регистрации</Link>{' '}
          или <Link href="/login">входа</Link>.
        </InlineNotice>
      )}
    </AuthPage>
  )
}
