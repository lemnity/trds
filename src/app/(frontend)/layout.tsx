import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { PageLoader } from '@/components/site/PageLoader'
import { SiteFooter } from '@/components/site/SiteFooter'
import { SiteHeader } from '@/components/site/SiteHeader'

import { onest } from './fonts'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Модный театр TURDUS — Екатеринбург', template: '%s — TURDUS' },
  description:
    'Иммерсивные спектакли модного театра TURDUS в Екатеринбурге: в барах, ресторанах, квартире и на улицах города.',
  // Превью на GitHub Pages не должно индексироваться вместо сайта театра.
  ...(process.env.PAGES_EXPORT === '1' && { robots: { index: false, follow: false } }),
}

export default function FrontendLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={onest.variable}>
      <body>
        <PageLoader />
        <a className="skip-link" href="#main">
          К содержанию
        </a>
        <Providers>
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  )
}
