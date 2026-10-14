'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { RouterProvider } from 'react-aria-components'

declare module 'react-aria-components' {
  interface RouterConfig {
    routerOptions: NonNullable<Parameters<ReturnType<typeof useRouter>['push']>[1]>
  }
}

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/**
 * Ссылки компонентов HeroUI (react-aria) переходят через роутер Next без перезагрузки,
 * а в атрибут href попадает префикс GitHub Pages (/trds).
 */
export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter()
  return (
    <RouterProvider
      navigate={(href, options) => router.push(href, options)}
      useHref={(href) => (href.startsWith('/') ? `${basePath}${href}` : href)}
    >
      {children}
    </RouterProvider>
  )
}
