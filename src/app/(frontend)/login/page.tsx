import type { Metadata } from 'next'

import { AuthPage } from '@/components/auth/AuthPage'

export const metadata: Metadata = {
  title: 'Вход',
  robots: { index: false, follow: false },
}

export default function LoginPage() {
  return <AuthPage mode="login" />
}
